import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { ownedOrNotFound, requireUser } from "./authz";
import { MESSAGE_BODY_MAX } from "./messageLimits";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    ownedOrNotFound(await ctx.db.get(args.projectId), userId);

    return await ctx.db
      .query("messages")
      .withIndex("by_projectId_and_createdAt", (q) =>
        q.eq("projectId", args.projectId),
      )
      .order("asc")
      .collect();
  },
});

export const send = mutation({
  args: {
    projectId: v.id("projects"),
    body: v.string(),
    clientMessageId: v.string(),
    slideId: v.optional(v.id("slides")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = ownedOrNotFound(await ctx.db.get(args.projectId), userId);
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_projectId_and_clientMessageId", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("clientMessageId", args.clientMessageId),
      )
      .unique();

    if (existing !== null) {
      const jobs = await ctx.db.query("jobs")
        .withIndex("by_projectId_and_sourceMessageId", (q) =>
          q.eq("projectId", args.projectId).eq("sourceMessageId", existing._id))
        .collect();
      const job = jobs.find((candidate) => candidate.attempt === 1) ??
        jobs.sort((a, b) => a.createdAt - b.createdAt || (a._id < b._id ? -1 : 1))[0] ?? null;
      return { message: existing, job };
    }

    const body = args.body.trim();
    if (body.length === 0) {
      throw new ConvexError("MESSAGE_EMPTY");
    }
    if (body.length > MESSAGE_BODY_MAX) {
      throw new ConvexError("MESSAGE_TOO_LONG");
    }

    if (args.slideId !== undefined) {
      const slide = await ctx.db.get(args.slideId);
      if (
        slide === null ||
        slide.userId !== userId ||
        slide.projectId !== project._id ||
        slide.revisionId !== project.currentSlidesRevisionId
      ) {
        throw new ConvexError("SLIDE_CONTEXT_INVALID");
      }
    }

    const createdAt = Date.now();
    const messageId = await ctx.db.insert("messages", {
      userId,
      projectId: args.projectId,
      role: "user",
      body,
      slideId: args.slideId,
      clientMessageId: args.clientMessageId,
      createdAt,
    });

    if (project.langgraphThreadId === undefined) {
      await ctx.db.patch(project._id, {
        langgraphThreadId: `thread_${project._id}_${createdAt}_${Math.random().toString(36).slice(2, 10)}`,
      });
    }

    const revisionId = project.currentRevisionId ?? `rev_${createdAt}`;
    const jobId = await ctx.db.insert("jobs", {
      userId,
      projectId: args.projectId,
      kind: "supervisor",
      status: "queued",
      revisionId,
      sourceMessageId: messageId,
      attempt: 1,
      createdAt,
    });
    await ctx.db.patch(project._id, { currentJobId: jobId });
    await ctx.scheduler.runAfter(0, internal.supervisor.runSupervisor, {
      userId, projectId: args.projectId, jobId, revisionId, sourceMessageId: messageId,
    });

    return { message: (await ctx.db.get(messageId))!, job: (await ctx.db.get(jobId))! };
  },
});
