import { mutation, query } from "./_generated/server";
import { requireUser } from "./authz";

export const QUESTION_CATALOG = [
  { questionId: "q_one_liner", required: true, sort: 0, title: "Одна фраза о продукте" },
  { questionId: "q_audience", required: true, sort: 1, title: "Аудитория" },
  { questionId: "q_problem", required: true, sort: 2, title: "Проблема" },
  { questionId: "q_difference", required: true, sort: 3, title: "Чем отличаетесь" },
  { questionId: "q_proof", required: false, sort: 4, title: "Доказательства" },
  { questionId: "q_cta", required: true, sort: 5, title: "Призыв к действию" },
] as const;

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("questions").collect();
    return rows.sort((a, b) => a.sort - b.sort);
  },
});

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const ids = [];
    for (const item of QUESTION_CATALOG) {
      const existing = await ctx.db
        .query("questions")
        .withIndex("by_questionId", (q) => q.eq("questionId", item.questionId))
        .first();
      if (existing) {
        ids.push(existing._id);
        continue;
      }
      ids.push(await ctx.db.insert("questions", item));
    }
    return ids;
  },
});
