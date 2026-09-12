import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { ownedOrNotFound, requireUser } from "./authz";

function earlierProduct(a: Doc<"projects">, b: Doc<"projects">) {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? a : b;
  }
  return a._id < b._id ? a : b;
}

async function listProducts(ctx: QueryCtx | MutationCtx, userId: string) {
  return await ctx.db
    .query("projects")
    .withIndex("by_userId_and_kind", (q) =>
      q.eq("userId", userId).eq("kind", "product"),
    )
    .collect();
}

async function keepOneProduct(ctx: MutationCtx, products: Doc<"projects">[]) {
  const kept = products.reduce(earlierProduct);
  for (const row of products) {
    if (row._id !== kept._id) {
      await ctx.db.delete(row._id);
    }
  }
  return kept;
}

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db.get(args.projectId);
    return ownedOrNotFound(project, userId);
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const products = await listProducts(ctx, userId);
    if (products.length === 0) {
      return null;
    }
    return products.reduce(earlierProduct);
  },
});

export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const existing = await listProducts(ctx, userId);
    if (existing.length === 0) {
      const now = Date.now();
      await ctx.db.insert("projects", {
        userId,
        kind: "product",
        status: "empty",
        currentRevisionId: `rev_${now}_${Math.random().toString(36).slice(2, 10)}`,
        createdAt: now,
      });
    }
    return await keepOneProduct(ctx, await listProducts(ctx, userId));
  },
});
