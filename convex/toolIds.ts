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
export const PLAN_TOOL_IDS = ["generate_presentation_plan"] as const;
export type PlanToolId = (typeof PLAN_TOOL_IDS)[number];
export const SLIDE_TOOL_IDS = ["generate_slides"] as const;
export type SlideToolId = (typeof SLIDE_TOOL_IDS)[number];
export type SupervisorToolId = ControlToolId | BriefToolId | PlanToolId | SlideToolId;
export const OFFERABLE_SKILL = "presentation_onboarding" as const;
