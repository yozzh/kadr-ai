import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { ownedOrNotFound, requireUser } from "./authz";
import { QUESTION_CATALOG } from "./questions";
import { EMPTY_THREAD_STATE, parseThreadState } from "./supervisorState";

const QUESTION_IDS = new Set<string>(QUESTION_CATALOG.map((item) => item.questionId));
const REQUIRED_IDS = QUESTION_CATALOG.filter((item) => item.required).map((item) => item.questionId);

type DbCtx = QueryCtx | MutationCtx;

async function answersFor(ctx: DbCtx, projectId: Id<"projects">, revisionId: string) {
  return (await ctx.db.query("briefAnswers").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect())
    .filter((answer) => answer.revisionId === revisionId);
}

export function isBriefComplete(answers: Array<Pick<Doc<"briefAnswers">, "questionId">>) {
  const closed = new Set(answers.map((answer) => answer.questionId));
  return REQUIRED_IDS.every((questionId) => closed.has(questionId));
}

async function progressFor(ctx: DbCtx, project: Doc<"projects">) {
  const revisionId = project.currentRevisionId ?? `brief_${project._id}`;
  const answers = await answersFor(ctx, project._id, revisionId);
  return {
    revisionId,
    answers: answers.sort((a, b) => {
      const left = QUESTION_CATALOG.find((item) => item.questionId === a.questionId)?.sort ?? 99;
      const right = QUESTION_CATALOG.find((item) => item.questionId === b.questionId)?.sort ?? 99;
      return left - right;
    }),
    complete: isBriefComplete(answers),
    closedCount: answers.length,
    totalCount: QUESTION_CATALOG.length,
    nextQuestion: QUESTION_CATALOG.find((item) => !answers.some((answer) => answer.questionId === item.questionId)) ?? null,
  };
}

export const progress = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = ownedOrNotFound(await ctx.db.get(args.projectId), userId);
    return { ...(await progressFor(ctx, project)), state: parseThreadState(project.langgraphThreadState), confirmed: project.confirmedBriefRevisionId !== undefined };
  },
});

const runtimeArgs = {
  userId: v.string(),
  projectId: v.id("projects"),
  jobId: v.id("jobs"),
  sourceMessageId: v.id("messages"),
};

async function activeTurn(ctx: MutationCtx, args: { userId: string; projectId: Id<"projects">; jobId: Id<"jobs">; sourceMessageId: Id<"messages"> }) {
  const [project, job, message] = await Promise.all([ctx.db.get(args.projectId), ctx.db.get(args.jobId), ctx.db.get(args.sourceMessageId)]);
  if (!project || !job || !message || project.userId !== args.userId || job.userId !== args.userId || message.userId !== args.userId ||
    job.projectId !== args.projectId || message.projectId !== args.projectId || job.sourceMessageId !== args.sourceMessageId ||
    job.kind !== "supervisor" || job.status !== "running") throw new ConvexError("NOT_FOUND");
  const state = parseThreadState(project.langgraphThreadState);
  if (state.activeSkill !== "presentation_onboarding" || project.confirmedBriefRevisionId !== undefined) throw new ConvexError("TOOL_NOT_AVAILABLE");
  return { project, message };
}

async function save(ctx: MutationCtx, args: { userId: string; projectId: Id<"projects">; jobId: Id<"jobs">; sourceMessageId: Id<"messages">; questionId: string; value: string; unknown: boolean }) {
  if (!QUESTION_IDS.has(args.questionId)) throw new ConvexError("BRIEF_QUESTION_UNKNOWN");
  const value = args.value.trim();
  if (!args.unknown && value.length === 0) throw new ConvexError("TOOL_ARGS_INVALID");
  if (value.length > 4000) throw new ConvexError("MESSAGE_TOO_LONG");
  const { project } = await activeTurn(ctx, args);
  let revisionId = project.currentRevisionId ?? `brief_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  let current = await answersFor(ctx, args.projectId, revisionId);
  const existing = current.find((answer) => answer.questionId === args.questionId);
  if (existing && isBriefComplete(current)) {
    const nextRevision = `brief_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    for (const answer of current) await ctx.db.insert("briefAnswers", { userId: answer.userId, projectId: answer.projectId, questionId: answer.questionId, revisionId: nextRevision, value: answer.value, unknown: answer.unknown, messageId: answer.messageId });
    revisionId = nextRevision;
    await ctx.db.patch(project._id, { currentRevisionId: revisionId });
    current = await answersFor(ctx, args.projectId, revisionId);
  } else if (project.currentRevisionId === undefined) {
    await ctx.db.patch(project._id, { currentRevisionId: revisionId });
  }
  const row = current.find((answer) => answer.questionId === args.questionId);
  const fields = { value: args.unknown ? "" : value, unknown: args.unknown, messageId: args.sourceMessageId };
  if (row) await ctx.db.patch(row._id, fields);
  else await ctx.db.insert("briefAnswers", { userId: args.userId, projectId: args.projectId, questionId: args.questionId, revisionId, ...fields });
  return await progressFor(ctx, { ...project, currentRevisionId: revisionId });
}

export const saveBriefAnswer = internalMutation({
  args: { ...runtimeArgs, questionId: v.string(), value: v.string() },
  handler: (ctx, args) => save(ctx, { ...args, unknown: false }),
});

export const markUnknown = internalMutation({
  args: { ...runtimeArgs, questionId: v.string() },
  handler: (ctx, args) => save(ctx, { ...args, value: "", unknown: true }),
});

async function confirm(ctx: MutationCtx, project: Doc<"projects">, revisionId: string) {
  if (project.confirmedBriefRevisionId !== undefined || project.status !== "empty") throw new ConvexError("TOOL_NOT_AVAILABLE");
  const state = parseThreadState(project.langgraphThreadState);
  if (state.activeSkill !== "presentation_onboarding" || revisionId !== project.currentRevisionId) throw new ConvexError("TOOL_NOT_AVAILABLE");
  const answers = await answersFor(ctx, project._id, revisionId);
  if (!isBriefComplete(answers)) throw new ConvexError("BRIEF_INCOMPLETE");
  await ctx.db.patch(project._id, { status: "brief_ready", confirmedBriefRevisionId: revisionId, langgraphThreadState: EMPTY_THREAD_STATE });
  return { status: "brief_ready" as const, confirmedBriefRevisionId: revisionId };
}

export const confirmBriefInternal = internalMutation({
  args: runtimeArgs,
  handler: async (ctx, args) => {
    const { project } = await activeTurn(ctx, args);
    if (!project.currentRevisionId) throw new ConvexError("BRIEF_INCOMPLETE");
    return await confirm(ctx, project, project.currentRevisionId);
  },
});

export const confirmBrief = mutation({
  args: { projectId: v.id("projects"), revisionId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return await confirm(ctx, ownedOrNotFound(await ctx.db.get(args.projectId), userId), args.revisionId);
  },
});
