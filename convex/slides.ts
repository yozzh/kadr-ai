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
  planRevisionId: v.string(),
  slidesRevisionId: v.string(),
};

const slideValidator = v.object({
  planItemId: v.id("planItems"),
  sort: v.number(),
  headline: v.string(),
  body: v.string(),
  placeholder: v.object({
    aspect: v.literal("9:16"),
    status: v.literal("empty"),
    description: v.string(),
  }),
});

export type SlideInput = {
  planItemId: Id<"planItems">;
  sort: number;
  headline: string;
  body: string;
  placeholder: { aspect: "9:16"; status: "empty"; description: string };
};

function invalid(slide: number | null, field: string): never {
  throw new ConvexError(`SLIDE_CONTENT_INVALID:slide=${slide ?? "null"}:field=${field}`);
}

function cleanString(value: unknown, max: number, slide: number, field: string) {
  if (typeof value !== "string") invalid(slide, field);
  const clean = value.trim();
  const length = Array.from(clean).length;
  if (length < 1 || length > max) invalid(slide, field);
  return clean;
}

export function validateSlides(input: unknown, planItems: Array<{ _id: Id<"planItems">; sort: number }>): SlideInput[] {
  if (!Array.isArray(input) || input.length !== planItems.length) invalid(null, "slides");
  const expected = new Map(planItems.map((item) => [String(item._id), item.sort]));
  const seen = new Set<string>();
  return input.map((raw, index) => {
    const slide = index + 1;
    if (!raw || typeof raw !== "object") invalid(slide, "slide");
    const item = raw as Record<string, unknown>;
    const planItemId = item.planItemId;
    if (typeof planItemId !== "string" || !expected.has(planItemId) || seen.has(planItemId)) invalid(slide, "planItemId");
    seen.add(planItemId);
    const sort = item.sort;
    if (typeof sort !== "number" || !Number.isInteger(sort) || sort !== expected.get(planItemId)) invalid(slide, "sort");
    const placeholder = item.placeholder;
    if (!placeholder || typeof placeholder !== "object" || Array.isArray(placeholder)) invalid(slide, "placeholder");
    const image = placeholder as Record<string, unknown>;
    if (Object.keys(image).length !== 3) invalid(slide, "placeholder");
    if (image.aspect !== "9:16") invalid(slide, "placeholder.aspect");
    if (image.status !== "empty") invalid(slide, "placeholder.status");
    return {
      planItemId: planItemId as Id<"planItems">,
      sort,
      headline: cleanString(item.headline, 120, slide, "headline"),
      body: cleanString(item.body, 700, slide, "body"),
      placeholder: {
        aspect: "9:16",
        status: "empty",
        description: cleanString(image.description, 1000, slide, "placeholder.description"),
      },
    };
  });
}

function slidesRevision() {
  return `slides_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function enqueue(ctx: MutationCtx, project: Doc<"projects">, userId: string, planRevisionId: string, retryOfJobId?: Id<"jobs">, attempt = 1) {
  const state = parseThreadState(project.langgraphThreadState);
  if (project.kind !== "product" || project.status !== "plan_ready" ||
    project.currentPlanRevisionId !== planRevisionId || state.activeSkill !== null || state.pendingIntent !== null) {
    throw new ConvexError("TOOL_NOT_AVAILABLE");
  }
  if (!retryOfJobId && project.currentSlidesJobId) {
    const current = await ctx.db.get(project.currentSlidesJobId);
    if (current?.kind === "slides" && current.revisionId === planRevisionId &&
      (current.status === "queued" || current.status === "running")) return current;
  }
  const jobId = await ctx.db.insert("jobs", {
    userId, projectId: project._id, kind: "slides", status: "queued", revisionId: planRevisionId,
    retryOfJobId, attempt, createdAt: Date.now(),
  });
  const outputRevisionId = slidesRevision();
  await ctx.db.patch(project._id, { currentSlidesJobId: jobId, currentSlidesRevisionId: outputRevisionId });
  await ctx.scheduler.runAfter(0, internal.slidesAction.run, {
    userId, projectId: project._id, jobId, planRevisionId, slidesRevisionId: outputRevisionId,
  });
  return await ctx.db.get(jobId);
}

export const generate = mutation({
  args: { projectId: v.id("projects"), planRevisionId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return await enqueue(ctx, ownedOrNotFound(await ctx.db.get(args.projectId), userId), userId, args.planRevisionId);
  },
});

export const enqueueInternal = internalMutation({
  args: { userId: v.string(), projectId: v.id("projects"), planRevisionId: v.string() },
  handler: async (ctx, args) => await enqueue(
    ctx, ownedOrNotFound(await ctx.db.get(args.projectId), args.userId), args.userId, args.planRevisionId,
  ),
});

export const retry = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const failed = ownedOrNotFound(await ctx.db.get(args.jobId), userId);
    if (failed.kind !== "slides" || failed.status !== "failed") throw new ConvexError("JOB_NOT_RETRYABLE");
    const project = ownedOrNotFound(await ctx.db.get(failed.projectId), userId);
    if (project.currentSlidesJobId !== failed._id) throw new ConvexError("JOB_NOT_RETRYABLE");
    return await enqueue(ctx, project, userId, failed.revisionId, failed._id, (failed.attempt ?? 1) + 1);
  },
});

export const current = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = ownedOrNotFound(await ctx.db.get(args.projectId), userId);
    const job = project.currentSlidesJobId ? await ctx.db.get(project.currentSlidesJobId) : null;
    const slides = project.currentSlidesRevisionId
      ? await ctx.db.query("slides").withIndex("by_projectId_and_revisionId", (q) =>
        q.eq("projectId", project._id).eq("revisionId", project.currentSlidesRevisionId!)).collect()
      : [];
    return { job: job?.userId === userId ? job : null, slides: slides.sort((a, b) => a.sort - b.sort) };
  },
});

export const load = internalMutation({
  args: runArgs,
  handler: async (ctx, args) => {
    const [project, job] = await Promise.all([ctx.db.get(args.projectId), ctx.db.get(args.jobId)]);
    if (!project || !job || project.userId !== args.userId || job.userId !== args.userId ||
      job.projectId !== project._id || job.kind !== "slides" || job.status !== "queued" ||
      job.revisionId !== args.planRevisionId || project.currentSlidesJobId !== job._id ||
      project.currentSlidesRevisionId !== args.slidesRevisionId || project.currentPlanRevisionId !== args.planRevisionId) {
      throw new ConvexError("SLIDES_JOB_INVALID");
    }
    const [answers, planItems] = await Promise.all([
      ctx.db.query("briefAnswers").withIndex("by_projectId", (q) => q.eq("projectId", project._id)).collect(),
      ctx.db.query("planItems").withIndex("by_projectId_and_revisionId", (q) =>
        q.eq("projectId", project._id).eq("revisionId", args.planRevisionId)).collect(),
    ]);
    if (!project.confirmedBriefRevisionId || planItems.length === 0) throw new ConvexError("SLIDES_JOB_INVALID");
    await ctx.db.patch(job._id, { status: "running" });
    return {
      brief: answers.filter((answer) => answer.revisionId === project.confirmedBriefRevisionId)
        .map(({ questionId, value, unknown }) => ({ questionId, value, unknown })),
      planItems: planItems.sort((a, b) => a.sort - b.sort).map(({ _id, sort, talkingPoint }) => ({ _id, sort, talkingPoint })),
    };
  },
});

export const apply = internalMutation({
  args: { ...runArgs, slides: v.array(slideValidator) },
  handler: async (ctx, args) => {
    const [project, job] = await Promise.all([ctx.db.get(args.projectId), ctx.db.get(args.jobId)]);
    if (!project || !job || project.userId !== args.userId || job.userId !== args.userId ||
      job.projectId !== project._id || job.kind !== "slides" || job.status !== "running" ||
      job.revisionId !== args.planRevisionId || project.currentSlidesJobId !== job._id ||
      project.currentSlidesRevisionId !== args.slidesRevisionId || project.currentPlanRevisionId !== args.planRevisionId) return { applied: false };
    const planItems = await ctx.db.query("planItems").withIndex("by_projectId_and_revisionId", (q) =>
      q.eq("projectId", project._id).eq("revisionId", args.planRevisionId)).collect();
    const clean = validateSlides(args.slides, planItems);
    const existing = await ctx.db.query("slides").withIndex("by_projectId_and_revisionId", (q) =>
      q.eq("projectId", project._id).eq("revisionId", args.slidesRevisionId)).collect();
    for (const slide of existing) await ctx.db.delete(slide._id);
    for (const slide of clean) await ctx.db.insert("slides", {
      ...slide, userId: args.userId, projectId: project._id, jobId: job._id, revisionId: args.slidesRevisionId,
    });
    await ctx.db.insert("messages", {
      userId: args.userId,
      projectId: project._id,
      role: "assistant",
      body: "Your presentation is ready.",
      createdAt: Date.now(),
    });
    await ctx.db.patch(job._id, { status: "succeeded", error: undefined, ranWith: {
      userId: args.userId, projectId: project._id, jobId: job._id, revisionId: args.planRevisionId,
    }});
    await ctx.db.patch(project._id, { status: "slides_ready" });
    return { applied: true };
  },
});

export const fail = internalMutation({
  args: { ...runArgs, error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const [project, job] = await Promise.all([ctx.db.get(args.projectId), ctx.db.get(args.jobId)]);
    if (!project || !job || project.userId !== args.userId || job.userId !== args.userId ||
      job.projectId !== project._id || job.kind !== "slides" || !["queued", "running"].includes(job.status) ||
      job.revisionId !== args.planRevisionId || project.currentSlidesJobId !== job._id ||
      project.currentSlidesRevisionId !== args.slidesRevisionId || project.currentPlanRevisionId !== args.planRevisionId) return { applied: false };
    const error = args.error?.match(/^SLIDE_CONTENT_INVALID:slide=(?:null|\d+):field=[a-z.]+$/)?.[0]
      ?? "SLIDES_GENERATION_FAILED";
    await ctx.db.patch(job._id, { status: "failed", error });
    return { applied: true };
  },
});
