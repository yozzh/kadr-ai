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
export const SLIDE_TOOL_IDS = ["generate_slides", "update_slide"] as const;
export type SlideToolId = (typeof SLIDE_TOOL_IDS)[number];
export const INFOGRAPHIC_TOOL_IDS = [
  "list_styles",
  "set_style",
  "generate_deck",
  "retry_failed_slots",
  "get_job",
] as const;
export type InfographicToolId = (typeof INFOGRAPHIC_TOOL_IDS)[number];
export type SupervisorToolId = ControlToolId | BriefToolId | PlanToolId | SlideToolId | InfographicToolId;
export const SKILL_IDS = ["presentation_onboarding", "fill_placeholders"] as const;
export type SkillId = (typeof SKILL_IDS)[number];
