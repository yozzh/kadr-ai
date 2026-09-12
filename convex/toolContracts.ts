import type { ThreadStateV1 } from "./supervisorState";
import type { SupervisorToolId } from "./toolIds";

export function listAvailableTools(
  state: ThreadStateV1,
  briefComplete = false,
  projectStatus: "empty" | "brief_ready" | "plan_ready" | "slides_ready" = "empty",
  confirmedBriefRevisionId?: string,
): SupervisorToolId[] {
  if (state.activeSkill === "fill_placeholders") {
    return ["clear_skill", "list_styles", "set_style"];
  }
  if (state.activeSkill === "presentation_onboarding") {
    return briefComplete
      ? ["clear_skill", "save_brief_answer", "mark_unknown", "confirm_brief"]
      : ["clear_skill", "save_brief_answer", "mark_unknown"];
  }
  if (state.pendingIntent !== null) {
    return ["offer_skill", "accept_skill_offer", "clear_skill"];
  }
  if (projectStatus === "brief_ready" && confirmedBriefRevisionId) {
    return ["offer_skill", "generate_presentation_plan"];
  }
  if (projectStatus === "plan_ready") {
    return ["offer_skill", "generate_slides"];
  }
  if (projectStatus === "slides_ready") {
    return ["offer_skill", "update_slide"];
  }
  return ["offer_skill"];
}

export function assertToolAllowed(id: SupervisorToolId, available: SupervisorToolId[]) {
  if (!available.includes(id)) throw new Error("TOOL_NOT_AVAILABLE");
}
