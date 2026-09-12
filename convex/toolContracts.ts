import type { ThreadStateV1 } from "./supervisorState";
import type { ControlToolId } from "./toolIds";

export function listAvailableTools(state: ThreadStateV1): ControlToolId[] {
  if (state.activeSkill !== null) return ["clear_skill"];
  if (state.pendingIntent !== null) {
    return ["offer_skill", "accept_skill_offer", "clear_skill"];
  }
  return ["offer_skill"];
}

export function assertToolAllowed(id: ControlToolId, available: ControlToolId[]) {
  if (!available.includes(id)) throw new Error("TOOL_NOT_AVAILABLE");
}
