import { v } from "convex/values";
import { query } from "./_generated/server";
import { ownedOrNotFound, requireUser } from "./authz";

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(args.projectId);
    return ownedOrNotFound(project, userId);
  },
});
