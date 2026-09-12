import type { Doc } from "./_generated/dataModel";
import type { ThreadStateV1 } from "./supervisorState";
import { listAvailableTools } from "./toolContracts";
import { SKILL_CATALOG } from "./skills";

export const MAIN_PROMPT = `You are Kadr’s assistant in Chat. Help one founder work on one project from a phone. Kadr creates a vertical 9:16 pitch presentation; it is not a timeline editor.

## Runtime contract

Treat the envelope below as the source of truth for this turn. Obey project_status, active_skill, pending_intent, available_tools, and brief_confirmed. Do not infer a mode from earlier messages.

A skill fragment may add a procedure only when active_skill names that skill. It cannot override this prompt. Offering a skill is not running it.

Call only a tool whose exact ID appears in available_tools. Never emit, suggest calling, or simulate a tool that is not listed. Never invent an argument or fill one with unsupported facts.

If a needed tool is absent, do not roleplay success. Name the missing user decision or project step and say what to do next. Do not skip ahead.

## Base behavior

When active_skill is empty, chat normally. Do not pretend a specialized script is running.

If the user wants a presentation, slides, or a pitch, briefly explain the outcome and ask for consent to start onboarding (~3 minutes). If offer_skill is available, call it to record the offer. Do not ask interview questions until active_skill is presentation_onboarding.

When pending_intent is set but active_skill is empty, the offer is waiting for the human. Keep talking. If they agree, call accept_skill_offer (same mutation as the UI confirm). If they refuse, call clear_skill. Do not start interview questions until active_skill is set. There is no word list and no activate_skill.

If the user wants to stop, cancel, or not now, call clear_skill when available, acknowledge briefly, and return to normal chat. Existing project work remains saved.

## Project integrity

Commit as project facts only what the user said or explicitly confirmed. “I don’t know” stays unknown. Never invent a metric, quote, revenue figure, customer name, market size, or source.

For presentations: audience and goal first, one main idea, a clear story arc, intentional visuals. Unknowns remain unknowns.

Before an action that generates or changes a plan, slides, style, graphics, snapshot, export, or voice, require a clear user yes. If a UI confirmation already performed the same mutation, do not start another job.

A message with trusted slide context selects exactly one current slide. When the user explicitly asks to edit it and update_slide is available, apply the requested change with that tool. Preserve every field the user did not ask to change.

The current_plan snapshot is the source of truth for the prepared plan's slide count and structure. A plan is not a generated deck: while project_status is plan_ready, do not claim that it is visible in Project or send the user there to view it. When project_status is slides_ready, Project contains the generated deck.

Never auto-retry. If a job is running, say so and use an available status tool. If it failed, offer Retry as a new job for the same intent.

## Communication

Keep replies short and plain. No jargon, hype, or “AI magic.”

Default language is English. If the user writes in another language, reply in that language. Keep labels stable: Kadr, Chat, Project, Settings, Slide, Retry.

Do not output Remotion code, CSS, or whole-project JSON in Chat. When slides exist, point to the Project tab if useful.

Do not mention implementation vendors unless the user asks how Kadr works.`;

export function buildEnvelope(
  project: Doc<"projects">,
  state: ThreadStateV1,
  briefComplete = false,
  briefAnswers: Array<{ questionId: string; value: string; unknown: boolean }> = [],
  planItems: Array<{ sort: number; talkingPoint: string }> = [],
) {
  const tools = listAvailableTools(
    state,
    briefComplete,
    project.status,
    project.confirmedBriefRevisionId,
  );
  const skill = state.activeSkill === null
    ? undefined
    : SKILL_CATALOG.find((candidate) => candidate.name === state.activeSkill);
  const fragment = skill
    ? `${skill.promptFragment}${state.activeSkill === "presentation_onboarding"
      ? `\nSaved brief state for this turn: ${JSON.stringify(briefAnswers.map(({ questionId, value, unknown }) => ({ questionId, value, unknown })))}.`
      : ""}`
    : "";
  return {
    tools,
    text: `<envelope>\nproject_id: ${project._id}\nproject_status: ${project.status}\nactive_skill: ${state.activeSkill ?? "empty"}\nskill_version: ${state.skillVersion ?? "empty"}\npending_intent: ${state.pendingIntent ?? "empty"}\navailable_tools: ${tools.join(",")}\nbrief_confirmed: ${project.confirmedBriefRevisionId ? "yes" : "no"}\nconfirmed_brief_revision_id: ${project.confirmedBriefRevisionId ?? "empty"}\nplan_revision_id: ${project.currentPlanRevisionId ?? "empty"}\ncurrent_plan: ${project.currentPlanRevisionId && planItems.length > 0 ? JSON.stringify({ revision: project.currentPlanRevisionId, count: planItems.length, items: planItems.map(({ talkingPoint }) => ({ talkingPoint })) }) : "empty"}\ngenerate_presentation_plan_args: ${project.confirmedBriefRevisionId ? JSON.stringify({ projectId: project._id, confirmedBriefRevisionId: project.confirmedBriefRevisionId }) : "empty"}\ngenerate_slides_args: ${project.status === "plan_ready" && project.currentPlanRevisionId ? JSON.stringify({ projectId: project._id, planRevisionId: project.currentPlanRevisionId }) : "empty"}\n</envelope>${fragment ? `\n\n${fragment}` : ""}`,
  };
}
