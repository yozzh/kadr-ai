"use node";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatXAI } from "@langchain/xai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { validateSlides } from "./slides";

const runArgs = {
  userId: v.string(), projectId: v.id("projects"), jobId: v.id("jobs"),
  planRevisionId: v.string(), slidesRevisionId: v.string(),
};

function parseContent(content: unknown) {
  const text = typeof content === "string" ? content : String(content);
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
}

export const run = internalAction({
  args: runArgs,
  handler: async (ctx, args) => {
    try {
      const input = await ctx.runMutation(internal.slides.load, args);
      const apiKey = process.env.XAI_API_KEY;
      const modelName = process.env.XAI_MODEL;
      if (!apiKey || !modelName) throw new Error("XAI_ENV_MISSING");
      const confirmedFacts = input.brief.filter((answer) => !answer.unknown)
        .map(({ questionId, value }) => ({ questionId, value }));
      const unknowns = input.brief.filter((answer) => answer.unknown).map(({ questionId }) => questionId);
      const response = await new ChatXAI({ apiKey, model: modelName }).invoke([
        new SystemMessage(`Return only a JSON array with exactly one slide for each supplied plan item, preserving its exact planItemId and sort. Each slide must have headline, body, and exactly one placeholder {aspect:"9:16",status:"empty",description}. Use only confirmed brief facts for claims; the brief overrides the plan. Unknowns stay unknown. Never invent numbers, customers, quotes, sources, causality, or stronger promises. Limits after trim in Unicode code points: headline 1..120, body 1..700, description 1..1000.`),
        new HumanMessage(JSON.stringify({ confirmedFacts, unknowns, plan: input.planItems })),
      ]);
      const slides = validateSlides(parseContent(response.content), input.planItems);
      await ctx.runMutation(internal.slides.apply, { ...args, slides });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const validationError = detail.match(/SLIDE_CONTENT_INVALID:slide=(?:null|\d+):field=[a-z.]+/)?.[0];
      await ctx.runMutation(internal.slides.fail, {
        ...args,
        error: validationError,
      });
    }
  },
});
