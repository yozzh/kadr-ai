import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { ownedOrNotFound, requireUser } from "./authz";
import { parseThreadState } from "./supervisorState";

const runArgs = {
  userId: v.string(),
  projectId: v.id("projects"),
  jobId: v.id("jobs"),
  briefRevisionId: v.string(),
  planRevisionId: v.string(),
};

function planRevision() {
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function enqueue(
  ctx: MutationCtx,
  project: Doc<"projects">,
  userId: string,
  briefRevisionId: string,
  retryOfJobId?: Id<"jobs">,
  attempt = 1,
) {
  const state = parseThreadState(project.langgraphThreadState);
  if (project.kind !== "product" || project.status !== "brief_ready" ||
    project.confirmedBriefRevisionId !== briefRevisionId || state.activeSkill !== null || state.pendingIntent !== null) {
    throw new ConvexError("TOOL_NOT_AVAILABLE");
  }
  if (!retryOfJobId && project.currentPlanJobId) {
    const current = await ctx.db.get(project.currentPlanJobId);
    if (current?.kind === "presentation_plan" && current.revisionId === briefRevisionId &&
      (current.status === "queued" || current.status === "running")) return current;
  }
  const now = Date.now();
  const outputRevisionId = planRevision();
  const jobId = await ctx.db.insert("jobs", {
    userId,
    projectId: project._id,
    kind: "presentation_plan",
    status: "queued",
    revisionId: briefRevisionId,
    retryOfJobId,
    attempt,
    createdAt: now,
  });
  await ctx.db.patch(project._id, { currentPlanJobId: jobId, currentPlanRevisionId: outputRevisionId });
  await ctx.scheduler.runAfter(0, internal.planAction.run, {
    userId, projectId: project._id, jobId, briefRevisionId, planRevisionId: outputRevisionId,
  });
  return await ctx.db.get(jobId);
}

export const generate = mutation({
  args: { projectId: v.id("projects"), confirmedBriefRevisionId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = ownedOrNotFound(await ctx.db.get(args.projectId), userId);
    return await enqueue(ctx, project, userId, args.confirmedBriefRevisionId);
  },
});

export const enqueueInternal = internalMutation({
  args: { userId: v.string(), projectId: v.id("projects"), briefRevisionId: v.string() },
  handler: async (ctx, args) => {
    const project = ownedOrNotFound(await ctx.db.get(args.projectId), args.userId);
    return await enqueue(ctx, project, args.userId, args.briefRevisionId);
  },
});

export const retry = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const failed = ownedOrNotFound(await ctx.db.get(args.jobId), userId);
    if (failed.kind !== "presentation_plan" || failed.status !== "failed") throw new ConvexError("JOB_NOT_RETRYABLE");
    const project = ownedOrNotFound(await ctx.db.get(failed.projectId), userId);
    if (project.currentPlanJobId !== failed._id) throw new ConvexError("JOB_NOT_RETRYABLE");
    return await enqueue(ctx, project, userId, failed.revisionId, failed._id, (failed.attempt ?? 1) + 1);
  },
});

export const current = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = ownedOrNotFound(await ctx.db.get(args.projectId), userId);
    const job = project.currentPlanJobId ? await ctx.db.get(project.currentPlanJobId) : null;
    const items = project.currentPlanRevisionId
      ? await ctx.db.query("planItems").withIndex("by_projectId_and_revisionId", (q) =>
        q.eq("projectId", project._id).eq("revisionId", project.currentPlanRevisionId!)).collect()
      : [];
    return { job: job && job.userId === userId ? job : null, items: items.sort((a, b) => a.sort - b.sort) };
  },
});

export const load = internalMutation({
  args: runArgs,
  handler: async (ctx, args) => {
    const [project, job] = await Promise.all([ctx.db.get(args.projectId), ctx.db.get(args.jobId)]);
    if (!project || !job || project.userId !== args.userId || job.userId !== args.userId ||
      job.projectId !== project._id || job.kind !== "presentation_plan" || job.status !== "queued" ||
      job.revisionId !== args.briefRevisionId || project.currentPlanJobId !== job._id ||
      project.currentPlanRevisionId !== args.planRevisionId || project.confirmedBriefRevisionId !== args.briefRevisionId) {
      throw new ConvexError("PLAN_JOB_INVALID");
    }
    const answers = (await ctx.db.query("briefAnswers").withIndex("by_projectId", (q) => q.eq("projectId", project._id)).collect())
      .filter((answer) => answer.revisionId === args.briefRevisionId);
    await ctx.db.patch(job._id, { status: "running" });
    return { answers: answers.map(({ questionId, value, unknown }) => ({ questionId, value, unknown })) };
  },
});

export const apply = internalMutation({
  args: { ...runArgs, items: v.array(v.object({ talkingPoint: v.string() })) },
  handler: async (ctx, args) => {
    const [project, job] = await Promise.all([ctx.db.get(args.projectId), ctx.db.get(args.jobId)]);
    if (!project || !job || project.userId !== args.userId || job.userId !== args.userId ||
      job.status !== "running" || job.projectId !== project._id || job.revisionId !== args.briefRevisionId ||
      project.currentPlanJobId !== job._id || project.currentPlanRevisionId !== args.planRevisionId ||
      project.confirmedBriefRevisionId !== args.briefRevisionId) return { applied: false };
    const clean = args.items.map((item) => item.talkingPoint.trim());
    if (clean.length === 0 || clean.some((item) => item.length === 0)) throw new ConvexError("PLAN_INVALID");
    const old = await ctx.db.query("planItems").withIndex("by_projectId_and_revisionId", (q) =>
      q.eq("projectId", project._id).eq("revisionId", args.planRevisionId)).collect();
    for (const item of old) await ctx.db.delete(item._id);
    for (const [sort, talkingPoint] of clean.entries()) await ctx.db.insert("planItems", {
      userId: args.userId, projectId: project._id, jobId: job._id,
      revisionId: args.planRevisionId, sort, talkingPoint,
    });
    await ctx.db.patch(job._id, { status: "succeeded", error: undefined, ranWith: {
      userId: args.userId, projectId: project._id, jobId: job._id, revisionId: args.briefRevisionId,
    }});
    await ctx.db.patch(project._id, { status: "plan_ready" });
    return { applied: true };
  },
});

export const fail = internalMutation({
  args: runArgs,
  handler: async (ctx, args) => {
    const [project, job] = await Promise.all([ctx.db.get(args.projectId), ctx.db.get(args.jobId)]);
    if (!project || !job || project.userId !== args.userId || job.userId !== args.userId ||
      job.projectId !== args.projectId || job.revisionId !== args.briefRevisionId ||
      !["queued", "running"].includes(job.status) || project.currentPlanJobId !== job._id ||
      project.currentPlanRevisionId !== args.planRevisionId || project.confirmedBriefRevisionId !== args.briefRevisionId) return { applied: false };
    await ctx.db.patch(job._id, { status: "failed", error: "PLAN_GENERATION_FAILED" });
    return { applied: true };
  },
});
