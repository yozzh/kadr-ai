import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
      return existing;
    }

    const body = args.body.trim();
    if (body.length === 0) {
      throw new ConvexError("MESSAGE_EMPTY");
    }
    if (body.length > MESSAGE_BODY_MAX) {
      throw new ConvexError("MESSAGE_TOO_LONG");
    }

    const createdAt = Date.now();
    const messageId = await ctx.db.insert("messages", {
      userId,
      projectId: args.projectId,
      role: "user",
      body,
      clientMessageId: args.clientMessageId,
      createdAt,
    });

    if (project.langgraphThreadId === undefined) {
      await ctx.db.patch(project._id, {
        langgraphThreadId: `thread_${project._id}_${createdAt}_${Math.random().toString(36).slice(2, 10)}`,
      });
    }

    return (await ctx.db.get(messageId))!;
  },
});
