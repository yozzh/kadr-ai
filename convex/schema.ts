import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const projectStatus = v.union(
  v.literal("empty"),
  v.literal("brief_ready"),
  v.literal("plan_ready"),
  v.literal("slides_ready"),
);

const jobStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
);

const projectKind = v.union(v.literal("probe"), v.literal("product"));

export default defineSchema({
  ...authTables,
  projects: defineTable({
    userId: v.string(),
    kind: projectKind,
    status: projectStatus,
    langgraphThreadId: v.optional(v.string()),
    langgraphThreadState: v.optional(v.any()),
    currentJobId: v.optional(v.id("jobs")),
    currentRevisionId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_kind", ["userId", "kind"]),

  messages: defineTable({
    userId: v.string(),
    projectId: v.id("projects"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    body: v.string(),
    clientMessageId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_projectId", ["projectId"]),

  briefAnswers: defineTable({
    userId: v.string(),
    projectId: v.id("projects"),
    questionId: v.string(),
    revisionId: v.string(),
    value: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_projectId", ["projectId"])
    .index("by_questionId", ["questionId"]),

  jobs: defineTable({
    userId: v.string(),
    projectId: v.id("projects"),
    kind: v.string(),
    status: jobStatus,
    revisionId: v.string(),
    error: v.optional(v.string()),
    ranWith: v.optional(
      v.object({
        userId: v.string(),
        projectId: v.id("projects"),
        jobId: v.id("jobs"),
        revisionId: v.string(),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_projectId", ["projectId"]),

  planItems: defineTable({
    userId: v.string(),
    projectId: v.id("projects"),
    revisionId: v.string(),
    sort: v.number(),
    talkingPoint: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_projectId", ["projectId"]),

  slides: defineTable({
    userId: v.string(),
    projectId: v.id("projects"),
    planItemId: v.id("planItems"),
    revisionId: v.string(),
    sort: v.number(),
    headline: v.string(),
    body: v.string(),
    placeholder: v.object({
      aspect: v.literal("9:16"),
      status: v.string(),
      description: v.string(),
    }),
  })
    .index("by_userId", ["userId"])
    .index("by_projectId", ["projectId"]),

  questions: defineTable({
    questionId: v.string(),
    required: v.boolean(),
    sort: v.number(),
    title: v.string(),
  }).index("by_questionId", ["questionId"]),

  skills: defineTable({
    name: v.string(),
    preconditions: v.array(v.string()),
    allowlistedTools: v.array(v.string()),
    bans: v.array(v.string()),
    promptFragment: v.string(),
  }),
});
