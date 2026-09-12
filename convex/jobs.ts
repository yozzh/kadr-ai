import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { ownedOrNotFound, requireUser } from "./authz";
import { isBriefComplete } from "./brief";

const probeArgs = {
  userId: v.string(),
  projectId: v.id("projects"),
  jobId: v.id("jobs"),
  revisionId: v.string(),
};

const supervisorArgs = {
  ...probeArgs,
  sourceMessageId: v.id("messages"),
};

export const get = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const job = await ctx.db.get(args.jobId);
    return ownedOrNotFound(job, userId);
  },
});

export const latestSupervisor = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    ownedOrNotFound(await ctx.db.get(args.projectId), userId);
    const jobs = await ctx.db.query("jobs").withIndex("by_projectId", (q) => q.eq("projectId", args.projectId)).collect();
    return jobs.filter((job) => job.kind === "supervisor")
      .sort((a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : -1))[0] ?? null;
  },
});

export const retrySupervisor = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const failed = ownedOrNotFound(await ctx.db.get(args.jobId), userId);
    if (failed.kind !== "supervisor" || failed.status !== "failed" || failed.sourceMessageId === undefined) {
      throw new ConvexError("JOB_NOT_RETRYABLE");
    }
    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", {
      userId,
      projectId: failed.projectId,
      kind: "supervisor",
      status: "queued",
      revisionId: failed.revisionId,
      sourceMessageId: failed.sourceMessageId,
      retryOfJobId: failed._id,
      attempt: (failed.attempt ?? 1) + 1,
      createdAt: now,
    });
    await ctx.db.patch(failed.projectId, { currentJobId: jobId });
    await ctx.scheduler.runAfter(0, internal.supervisor.runSupervisor, {
      userId, projectId: failed.projectId, jobId, revisionId: failed.revisionId,
      sourceMessageId: failed.sourceMessageId,
    });
    return await ctx.db.get(jobId);
  },
});

export const loadSupervisorTurn = internalMutation({
  args: supervisorArgs,
  handler: async (ctx, args) => {
    const [project, job, sourceMessage] = await Promise.all([
      ctx.db.get(args.projectId), ctx.db.get(args.jobId), ctx.db.get(args.sourceMessageId),
    ]);
    if (project === null || job === null || sourceMessage === null || project.userId !== args.userId ||
      job.userId !== args.userId || sourceMessage.userId !== args.userId || job.projectId !== args.projectId ||
      sourceMessage.projectId !== args.projectId || job.revisionId !== args.revisionId || job.status !== "queued") {
      throw new ConvexError("SUPERVISOR_JOB_INVALID");
    }
    const messages = await ctx.db.query("messages")
      .withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", args.projectId))
      .order("asc").collect();
    const briefAnswers = project.currentRevisionId
      ? (await ctx.db.query("briefAnswers").withIndex("by_projectId", (q) => q.eq("projectId", args.projectId)).collect())
        .filter((answer) => answer.revisionId === project.currentRevisionId)
      : [];
    const planItems = project.currentPlanRevisionId
      ? await ctx.db.query("planItems").withIndex("by_projectId_and_revisionId", (q) =>
        q.eq("projectId", project._id).eq("revisionId", project.currentPlanRevisionId!)).collect()
      : [];
    const sourceIndex = messages.findIndex((message) => message._id === args.sourceMessageId);
    if (sourceIndex < 0) throw new ConvexError("SUPERVISOR_JOB_INVALID");
    const safeMessages = await Promise.all(messages.slice(0, sourceIndex + 1).map(async (message) => {
      if (message.role !== "user" || message.slideId === undefined) return message;
      const slide = await ctx.db.get(message.slideId);
      if (!slide || slide.userId !== args.userId || slide.projectId !== project._id ||
        slide.revisionId !== project.currentSlidesRevisionId) return { ...message, slideId: undefined };
      return { ...message, slideContext: { number: slide.sort + 1, headline: slide.headline } };
    }));
    await ctx.db.patch(args.jobId, { status: "running" });
    return {
      project,
      messages: safeMessages,
      briefAnswers,
      briefComplete: isBriefComplete(briefAnswers),
      planItems: planItems.sort((a, b) => a.sort - b.sort)
        .map(({ sort, talkingPoint }) => ({ sort, talkingPoint })),
    };
  },
});

export const completeSupervisor = internalMutation({
  args: { ...supervisorArgs, body: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const project = await ctx.db.get(args.projectId);
    if (job === null || project === null || job.status !== "running" || job.userId !== args.userId ||
      project.userId !== args.userId || job.projectId !== args.projectId || job.revisionId !== args.revisionId ||
      job.sourceMessageId !== args.sourceMessageId) return { applied: false };
    await ctx.db.insert("messages", { userId: args.userId, projectId: args.projectId, role: "assistant", body: args.body, createdAt: Date.now() });
    await ctx.db.patch(args.jobId, { status: "succeeded", error: undefined, ranWith: {
      userId: args.userId, projectId: args.projectId, jobId: args.jobId, revisionId: args.revisionId,
    }});
    return { applied: true };
  },
});

export const failSupervisor = internalMutation({
  args: { ...supervisorArgs, error: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job === null || job.userId !== args.userId || job.projectId !== args.projectId ||
      job.sourceMessageId !== args.sourceMessageId || !["queued", "running"].includes(job.status)) return { applied: false };
    await ctx.db.patch(args.jobId, { status: "failed", error: args.error });
    return { applied: true };
  },
});

export const startProbe = mutation({
  args: { fail: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const probe = existing.find((row) => row.kind === "probe");
    const projectId =
      probe?._id ??
      (await ctx.db.insert("projects", {
        userId,
        kind: "probe",
        status: "empty",
        createdAt: now,
      }));

    const revisionId = `rev_${now}_${Math.random().toString(36).slice(2, 10)}`;
    const jobId = await ctx.db.insert("jobs", {
      userId,
      projectId,
      kind: "probe",
      status: "queued",
      revisionId,
      createdAt: now,
    });

    await ctx.db.patch(projectId, {
      currentJobId: jobId,
      currentRevisionId: revisionId,
    });

    await ctx.scheduler.runAfter(0, internal.jobs.runProbe, {
      userId,
      projectId,
      jobId,
      revisionId,
      fail: args.fail,
    });

    return { userId, projectId, jobId, revisionId };
  },
});

export const applyProbeResult = internalMutation({
  args: {
    ...probeArgs,
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (
      project === null ||
      project.currentJobId !== args.jobId ||
      project.currentRevisionId !== args.revisionId
    ) {
      return { applied: false };
    }

    await ctx.db.patch(args.jobId, {
      status: args.status,
      error: args.error,
      ranWith: {
        userId: args.userId,
        projectId: args.projectId,
        jobId: args.jobId,
        revisionId: args.revisionId,
      },
    });
    return { applied: true };
  },
});

export const runProbe = internalAction({
  args: {
    ...probeArgs,
    fail: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    try {
      if (args.fail) {
        throw new Error("probe_failed");
      }
      await ctx.runMutation(internal.jobs.applyProbeResult, {
        userId: args.userId,
        projectId: args.projectId,
        jobId: args.jobId,
        revisionId: args.revisionId,
        status: "succeeded",
      });
    } catch (error) {
      await ctx.runMutation(internal.jobs.applyProbeResult, {
        userId: args.userId,
        projectId: args.projectId,
        jobId: args.jobId,
        revisionId: args.revisionId,
        status: "failed",
        error: error instanceof Error ? error.message : "probe_failed",
      });
    }
  },
});
