import { mutation } from "./_generated/server";
import { requireUser } from "./authz";

export const SKILL_CATALOG = [{
  name: "presentation_onboarding",
  version: 1,
  preconditions: ["brief_not_confirmed"],
  allowlistedTools: ["save_brief_answer", "mark_unknown", "confirm_brief"],
  bans: ["generate_presentation_plan", "generate_slides"],
  promptFragment: "",
}] as const;

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    for (const skill of SKILL_CATALOG) {
      const existing = await ctx.db.query("skills")
        .withIndex("by_name_and_version", (q) => q.eq("name", skill.name).eq("version", skill.version))
        .unique();
      if (existing === null) await ctx.db.insert("skills", { ...skill, preconditions: [...skill.preconditions], allowlistedTools: [...skill.allowlistedTools], bans: [...skill.bans] });
    }
    return SKILL_CATALOG.length;
  },
});
