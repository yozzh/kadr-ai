import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { ownedOrNotFound, requireUser } from "./authz";
import { OFFERABLE_SKILL } from "./toolIds";

export type ThreadStateV1 = {
  schemaVersion: 1;
  activeSkill: typeof OFFERABLE_SKILL | null;
  skillVersion: 1 | null;
  pendingIntent: `offer_skill:${typeof OFFERABLE_SKILL}` | null;
};

export const EMPTY_THREAD_STATE: ThreadStateV1 = {
  schemaVersion: 1,
  activeSkill: null,
  skillVersion: null,
  pendingIntent: null,
};

export function parseThreadState(value: unknown): ThreadStateV1 {
  if (value === undefined) return EMPTY_THREAD_STATE;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConvexError("INVALID_THREAD_STATE");
  }
  const state = value as Record<string, unknown>;
  if (
    Object.keys(state).sort().join(",") !==
      "activeSkill,pendingIntent,schemaVersion,skillVersion" ||
    state.schemaVersion !== 1 ||
    !(
      (state.activeSkill === null && state.skillVersion === null) ||
      (state.activeSkill === OFFERABLE_SKILL && state.skillVersion === 1)
    ) ||
    !(state.pendingIntent === null || state.pendingIntent === `offer_skill:${OFFERABLE_SKILL}`) ||
    (state.activeSkill !== null && state.pendingIntent !== null)
  ) {
    throw new ConvexError("INVALID_THREAD_STATE");
  }
  return state as ThreadStateV1;
}

const controlArgs = {
  userId: v.string(),
  projectId: v.id("projects"),
  jobId: v.id("jobs"),
};

async function ownedTurn(ctx: any, args: any) {
  const [project, job] = await Promise.all([
    ctx.db.get(args.projectId),
    ctx.db.get(args.jobId),
  ]);
  if (
    project === null || job === null || project.userId !== args.userId ||
    job.userId !== args.userId || job.projectId !== args.projectId ||
    job.kind !== "supervisor" || job.status !== "running"
  ) throw new ConvexError("NOT_FOUND");
  return { project, state: parseThreadState(project.langgraphThreadState) };
}

function acceptedState(state: ThreadStateV1): ThreadStateV1 {
  if (state.pendingIntent !== `offer_skill:${OFFERABLE_SKILL}`) {
    throw new ConvexError("TOOL_NOT_AVAILABLE");
  }
  return {
    schemaVersion: 1,
    activeSkill: OFFERABLE_SKILL,
    skillVersion: 1,
    pendingIntent: null,
  };
}

export const offerSkill = internalMutation({
  args: { ...controlArgs, skill: v.string() },
  handler: async (ctx, args) => {
    const { project, state } = await ownedTurn(ctx, args);
    if (args.skill !== OFFERABLE_SKILL || project.status !== "empty" || state.activeSkill !== null) {
      throw new ConvexError("SKILL_NOT_OFFERABLE");
    }
    await ctx.db.patch(args.projectId, {
      langgraphThreadState: { ...state, pendingIntent: `offer_skill:${OFFERABLE_SKILL}` },
    });
    return "Skill offer recorded.";
  },
});

export const acceptSkillOfferInternal = internalMutation({
  args: controlArgs,
  handler: async (ctx, args) => {
    const { state } = await ownedTurn(ctx, args);
    await ctx.db.patch(args.projectId, { langgraphThreadState: acceptedState(state) });
    return "Skill accepted.";
  },
});

export const acceptSkillOffer = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = ownedOrNotFound(await ctx.db.get(args.projectId), userId);
    const state = parseThreadState(project.langgraphThreadState);
    const next = acceptedState(state);
    await ctx.db.patch(args.projectId, { langgraphThreadState: next });
    return next;
  },
});

export const clearSkillForUser = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = ownedOrNotFound(await ctx.db.get(args.projectId), userId);
    const state = parseThreadState(project.langgraphThreadState);
    if (state.pendingIntent === null && state.activeSkill === null) throw new ConvexError("TOOL_NOT_AVAILABLE");
    await ctx.db.patch(project._id, { langgraphThreadState: EMPTY_THREAD_STATE });
    return EMPTY_THREAD_STATE;
  },
});

export const clearSkill = internalMutation({
  args: controlArgs,
  handler: async (ctx, args) => {
    const { state } = await ownedTurn(ctx, args);
    if (state.pendingIntent === null && state.activeSkill === null) {
      throw new ConvexError("TOOL_NOT_AVAILABLE");
    }
    await ctx.db.patch(args.projectId, { langgraphThreadState: EMPTY_THREAD_STATE });
    return "Skill cleared.";
  },
});
