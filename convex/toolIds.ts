export const CONTROL_TOOL_IDS = [
  "offer_skill",
  "accept_skill_offer",
  "clear_skill",
] as const;

export type ControlToolId = (typeof CONTROL_TOOL_IDS)[number];
export const OFFERABLE_SKILL = "presentation_onboarding" as const;
