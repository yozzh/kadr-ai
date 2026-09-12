"use node";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatXAI } from "@langchain/xai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const runArgs = {
  userId: v.string(),
  projectId: v.id("projects"),
  jobId: v.id("jobs"),
  briefRevisionId: v.string(),
  planRevisionId: v.string(),
};

function parseItems(content: unknown) {
  const text = typeof content === "string" ? content : String(content);
  const parsed: unknown = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  if (!Array.isArray(parsed)) throw new Error("PLAN_INVALID");
  return parsed.map((item) => {
    if (!item || typeof item !== "object" || !("talkingPoint" in item) || typeof item.talkingPoint !== "string" || !item.talkingPoint.trim()) throw new Error("PLAN_INVALID");
    return { talkingPoint: item.talkingPoint.trim() };
  });
}

export const run = internalAction({
  args: runArgs,
  handler: async (ctx, args) => {
    try {
      const { answers } = await ctx.runMutation(internal.plan.load, args);
      const apiKey = process.env.XAI_API_KEY;
      const modelName = process.env.XAI_MODEL;
      if (!apiKey || !modelName) throw new Error("XAI_ENV_MISSING");
      const facts = answers.filter((a) => !a.unknown).map(({ questionId, value }) => ({ questionId, value }));
      const unknowns = answers.filter((a) => a.unknown).map(({ questionId }) => questionId);
      const response = await new ChatXAI({ apiKey, model: modelName }).invoke([
        new SystemMessage("Return only a non-empty JSON array of objects with one non-empty talkingPoint each. Build a concise presentation plan only from confirmed facts. Unknowns must remain unknown: never invent numbers, metrics, testimonials, customers, quotes, or sources."),
        new HumanMessage(JSON.stringify({ confirmedFacts: facts, unknowns })),
      ]);
      await ctx.runMutation(internal.plan.apply, { ...args, items: parseItems(response.content) });
    } catch {
      await ctx.runMutation(internal.plan.fail, args);
    }
  },
});
