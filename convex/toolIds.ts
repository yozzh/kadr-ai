export const CONTROL_TOOL_IDS = [
  "offer_skill",
  "accept_skill_offer",
  "clear_skill",
] as const;

export type ControlToolId = (typeof CONTROL_TOOL_IDS)[number];
export const BRIEF_TOOL_IDS = [
  "save_brief_answer",
  "mark_unknown",
  "confirm_brief",
] as const;
export type BriefToolId = (typeof BRIEF_TOOL_IDS)[number];
export type SupervisorToolId = ControlToolId | BriefToolId;
export const OFFERABLE_SKILL = "presentation_onboarding" as const;
