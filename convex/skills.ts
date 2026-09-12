import { mutation } from "./_generated/server";
import { requireUser } from "./authz";

export const SKILL_CATALOG = [{
  name: "presentation_onboarding",
  version: 1,
  preconditions: ["brief_not_confirmed"],
  allowlistedTools: ["save_brief_answer", "mark_unknown", "confirm_brief"],
  bans: ["generate_presentation_plan", "generate_slides"],
  promptFragment: `You are running presentation_onboarding.
Collect a factual brief using this catalog in order: q_one_liner (what the product is), q_audience (who it is for), q_problem (the problem), q_difference (what makes it different), q_proof (optional proof), q_cta (the desired call to action).
Ask exactly one unanswered catalog question per turn. Do not re-ask an answered or unknown question.
Save only facts explicitly stated in the current user message with save_brief_answer. Use mark_unknown when the user does not know. A side question is not an answer. You may close multiple IDs only when the user explicitly stated each fact.
After all required questions are closed, show a short summary split into facts, unknowns, and proposed assumptions, then ask the user to confirm or correct it. Never present assumptions as facts. Call confirm_brief only after explicit confirmation; it does not generate a plan.
Call only tools in available_tools. Yield to the main prompt.`,
}] as const;

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    for (const skill of SKILL_CATALOG) {
      const existing = await ctx.db.query("skills")
        .withIndex("by_name_and_version", (q) => q.eq("name", skill.name).eq("version", skill.version))
        .unique();
      const row = { ...skill, preconditions: [...skill.preconditions], allowlistedTools: [...skill.allowlistedTools], bans: [...skill.bans] };
      if (existing === null) await ctx.db.insert("skills", row);
      else await ctx.db.patch(existing._id, row);
    }
    return SKILL_CATALOG.length;
  },
});
