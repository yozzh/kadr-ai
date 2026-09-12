import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { ownedOrNotFound, requireUser } from "./authz";

const probeArgs = {
  userId: v.string(),
  projectId: v.id("projects"),
  jobId: v.id("jobs"),
  revisionId: v.string(),
};

export const get = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const job = await ctx.db.get(args.jobId);
    return ownedOrNotFound(job, userId);
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
