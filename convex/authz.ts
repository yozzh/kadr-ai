import { getAuthUserId } from "@convex-dev/auth/server";
import type { Auth } from "convex/server";
import { ConvexError } from "convex/values";

export async function requireUser(ctx: { auth: Auth }): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("UNAUTHENTICATED");
  }
  return String(userId);
}

export function ownedOrNotFound<T extends { userId: string }>(
  doc: T | null,
  userId: string,
): T {
  if (doc === null || doc.userId !== userId) {
    throw new ConvexError("NOT_FOUND");
  }
  return doc;
}
