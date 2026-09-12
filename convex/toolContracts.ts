import type { ThreadStateV1 } from "./supervisorState";
import type { SupervisorToolId } from "./toolIds";

export function listAvailableTools(
  state: ThreadStateV1,
  briefComplete = false,
): SupervisorToolId[] {
  if (state.activeSkill !== null) {
    return briefComplete
      ? ["clear_skill", "save_brief_answer", "mark_unknown", "confirm_brief"]
      : ["clear_skill", "save_brief_answer", "mark_unknown"];
  }
  if (state.pendingIntent !== null) {
    return ["offer_skill", "accept_skill_offer", "clear_skill"];
  }
  return ["offer_skill"];
}

export function assertToolAllowed(id: SupervisorToolId, available: SupervisorToolId[]) {
  if (!available.includes(id)) throw new Error("TOOL_NOT_AVAILABLE");
}
