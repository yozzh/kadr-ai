"use node";

import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatXAI } from "@langchain/xai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { buildEnvelope, MAIN_PROMPT } from "./supervisorPrompt";
import { parseThreadState } from "./supervisorState";
import { listStyles } from "./styles";

const argsValidator = {
  userId: v.string(), projectId: v.id("projects"), jobId: v.id("jobs"),
  revisionId: v.string(), sourceMessageId: v.id("messages"),
};

function textContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
    return "";
  }).join("").trim();
  return "";
}

export function assertPlanToolRuntimeArgs(
  provided: { projectId: string; confirmedBriefRevisionId: string },
  expected: { projectId: string; confirmedBriefRevisionId?: string },
) {
  if (provided.projectId !== expected.projectId ||
    provided.confirmedBriefRevisionId !== expected.confirmedBriefRevisionId) throw new Error("TOOL_ARGS_INVALID");
}

export function assertSlidesToolRuntimeArgs(
  provided: { projectId: string; planRevisionId: string },
  expected: { projectId: string; planRevisionId?: string },
) {
  if (provided.projectId !== expected.projectId || provided.planRevisionId !== expected.planRevisionId) {
    throw new Error("TOOL_ARGS_INVALID");
  }
}

export const runSupervisor = internalAction({
  args: argsValidator,
  handler: async (ctx, args) => {
    try {
      const turn = await ctx.runMutation(internal.jobs.loadSupervisorTurn, args);
      const state = parseThreadState(turn.project.langgraphThreadState);
      const envelope = buildEnvelope(turn.project, state, turn.briefComplete, turn.briefAnswers, turn.planItems);
      const common = { userId: args.userId, projectId: args.projectId, jobId: args.jobId };
      const available = new Set(envelope.tools);
      const tools = [
        tool(async ({ skill }: { skill: string }) => {
          if (!available.has("offer_skill")) throw new Error("TOOL_NOT_AVAILABLE");
          return await ctx.runMutation(internal.supervisorState.offerSkill, { ...common, skill });
        }, { name: "offer_skill", description: "Record an offer to start an offerable skill without activating it.", schema: {
          type: "object", properties: { skill: { type: "string", enum: ["presentation_onboarding", "fill_placeholders"] } }, required: ["skill"], additionalProperties: false,
        } }),
        tool(async () => {
          if (!available.has("accept_skill_offer")) throw new Error("TOOL_NOT_AVAILABLE");
          return await ctx.runMutation(internal.supervisorState.acceptSkillOfferInternal, common);
        }, { name: "accept_skill_offer", description: "Accept the pending skill offer.", schema: { type: "object", properties: {}, additionalProperties: false } }),
        tool(async () => {
          if (!available.has("clear_skill")) throw new Error("TOOL_NOT_AVAILABLE");
          return await ctx.runMutation(internal.supervisorState.clearSkill, common);
        }, { name: "clear_skill", description: "Clear the pending or active skill.", schema: { type: "object", properties: {}, additionalProperties: false } }),
        tool(async ({ questionId, value }: { questionId: string; value: string }) => {
          if (!available.has("save_brief_answer")) throw new Error("TOOL_NOT_AVAILABLE");
          return await ctx.runMutation(internal.brief.saveBriefAnswer, { ...common, sourceMessageId: args.sourceMessageId, questionId, value });
        }, { name: "save_brief_answer", description: "Save one fact explicitly stated by the user for a catalog question.", schema: {
          type: "object", properties: { questionId: { type: "string" }, value: { type: "string" } }, required: ["questionId", "value"], additionalProperties: false,
        } }),
        tool(async ({ questionId }: { questionId: string }) => {
          if (!available.has("mark_unknown")) throw new Error("TOOL_NOT_AVAILABLE");
          return await ctx.runMutation(internal.brief.markUnknown, { ...common, sourceMessageId: args.sourceMessageId, questionId });
        }, { name: "mark_unknown", description: "Record that the user explicitly does not know a catalog answer.", schema: {
          type: "object", properties: { questionId: { type: "string" } }, required: ["questionId"], additionalProperties: false,
        } }),
        tool(async () => {
          if (!available.has("confirm_brief")) throw new Error("TOOL_NOT_AVAILABLE");
          return await ctx.runMutation(internal.brief.confirmBriefInternal, { ...common, sourceMessageId: args.sourceMessageId });
        }, { name: "confirm_brief", description: "Confirm the complete active brief revision without generating a plan.", schema: { type: "object", properties: {}, additionalProperties: false } }),
        tool(async ({ projectId, confirmedBriefRevisionId }: { projectId: string; confirmedBriefRevisionId: string }) => {
          if (!available.has("generate_presentation_plan")) throw new Error("TOOL_NOT_AVAILABLE");
          assertPlanToolRuntimeArgs(
            { projectId, confirmedBriefRevisionId },
            { projectId: String(args.projectId), confirmedBriefRevisionId: turn.project.confirmedBriefRevisionId },
          );
          return await ctx.runMutation(internal.plan.enqueueInternal, {
            userId: args.userId,
            projectId: args.projectId,
            briefRevisionId: confirmedBriefRevisionId,
          });
        }, { name: "generate_presentation_plan", description: "Queue generation of a presentation plan from the confirmed brief using the exact IDs in the runtime envelope.", schema: {
          type: "object",
          properties: { projectId: { type: "string" }, confirmedBriefRevisionId: { type: "string" } },
          required: ["projectId", "confirmedBriefRevisionId"],
          additionalProperties: false,
        } }),
        tool(async ({ projectId, planRevisionId }: { projectId: string; planRevisionId: string }) => {
          if (!available.has("generate_slides")) throw new Error("TOOL_NOT_AVAILABLE");
          assertSlidesToolRuntimeArgs(
            { projectId, planRevisionId },
            { projectId: String(args.projectId), planRevisionId: turn.project.currentPlanRevisionId },
          );
          return await ctx.runMutation(internal.slides.enqueueInternal, {
            userId: args.userId, projectId: args.projectId, planRevisionId,
          });
        }, { name: "generate_slides", description: "Queue slides from the current plan using the exact IDs in the runtime envelope.", schema: {
          type: "object",
          properties: { projectId: { type: "string" }, planRevisionId: { type: "string" } },
          required: ["projectId", "planRevisionId"],
          additionalProperties: false,
        } }),
        tool(async ({ headline, body, placeholderDescription }: {
          headline: string; body: string; placeholderDescription: string;
        }) => {
          if (!available.has("update_slide")) throw new Error("TOOL_NOT_AVAILABLE");
          const sourceMessage = turn.messages[turn.messages.length - 1];
          const slideContext = sourceMessage && "slideContext" in sourceMessage ? sourceMessage.slideContext : undefined;
          if (!slideContext) throw new Error("SLIDE_CONTEXT_INVALID");
          return await ctx.runMutation(internal.slides.updateInternal, {
            userId: args.userId,
            projectId: args.projectId,
            slideId: slideContext.id,
            headline,
            body,
            placeholderDescription,
          });
        }, { name: "update_slide", description: "Update the selected current slide after the user explicitly requests the change. Send the complete replacement headline, body, and visual description, preserving fields the user did not ask to change.", schema: {
          type: "object",
          properties: {
            headline: { type: "string" },
            body: { type: "string" },
            placeholderDescription: { type: "string" },
          },
          required: ["headline", "body", "placeholderDescription"],
          additionalProperties: false,
        } }),
        tool(async () => {
          if (!available.has("list_styles")) throw new Error("TOOL_NOT_AVAILABLE");
          return listStyles();
        }, { name: "list_styles", description: "List the six trusted infographic styles available for this deck.", schema: {
          type: "object", properties: {}, additionalProperties: false,
        } }),
        tool(async ({ styleId }: { styleId: string }) => {
          if (!available.has("set_style")) throw new Error("TOOL_NOT_AVAILABLE");
          return await ctx.runMutation(internal.styles.setStyle, { ...common, styleId });
        }, { name: "set_style", description: "Save an explicitly confirmed catalog style for the current deck. This does not generate images.", schema: {
          type: "object",
          properties: { styleId: { type: "string", enum: ["paper-ink", "dark-precision", "bold-primitives", "soft-product", "blueprint-grid", "poster-hook"] } },
          required: ["styleId"],
          additionalProperties: false,
        } }),
      ].filter((candidate) => available.has(candidate.name as never));
      const apiKey = process.env.XAI_API_KEY;
      const modelName = process.env.XAI_MODEL;
      if (!apiKey || !modelName) throw new Error("XAI_ENV_MISSING");
      const model = new ChatXAI({ apiKey, model: modelName });
      const agent = createReactAgent({ llm: model, tools, checkpointSaver: new MemorySaver(), prompt: new SystemMessage(`${MAIN_PROMPT}\n\n${envelope.text}`) });
      const result = await agent.invoke({ messages: turn.messages.map((message) => {
        if (message.role === "assistant") return new AIMessage(message.body);
        const prefix = "slideContext" in message && message.slideContext
          ? `[Trusted slide context: ${JSON.stringify(message.slideContext)}. If the user explicitly requests a change to this slide and update_slide is available, apply it with complete replacement fields and then briefly confirm what changed.]\n`
          : "";
        return new HumanMessage(`${prefix}${message.body}`);
      }) }, {
        configurable: { thread_id: turn.project.langgraphThreadId ?? String(args.projectId) },
      });
      const reply = [...result.messages].reverse().find((message) => message instanceof AIMessage);
      const body = textContent(reply?.content);
      if (!body) throw new Error("EMPTY_SUPERVISOR_REPLY");
      await ctx.runMutation(internal.jobs.completeSupervisor, { ...args, body });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.jobs.failSupervisor, {
        ...args, error: detail.includes("INVALID_THREAD_STATE") ? "INVALID_THREAD_STATE" : "SUPERVISOR_FAILED",
      });
    }
  },
});
