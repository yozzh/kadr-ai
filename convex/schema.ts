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
    confirmedBriefRevisionId: v.optional(v.string()),
    currentPlanJobId: v.optional(v.id("jobs")),
    currentPlanRevisionId: v.optional(v.string()),
    currentSlidesJobId: v.optional(v.id("jobs")),
    currentSlidesRevisionId: v.optional(v.string()),
    infographicStyle: v.optional(v.object({
      styleId: v.string(),
      label: v.string(),
      oneLiner: v.string(),
      paletteRule: v.string(),
      compositionApproach: v.string(),
      promptPrefix: v.string(),
      catalogVersion: v.literal(1),
    })),
    styleRevisionId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_and_kind", ["userId", "kind"]),

  messages: defineTable({
    userId: v.string(),
    projectId: v.id("projects"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    body: v.string(),
    slideId: v.optional(v.id("slides")),
    clientMessageId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_createdAt", ["projectId", "createdAt"])
    .index("by_projectId_and_clientMessageId", [
      "projectId",
      "clientMessageId",
    ]),

  briefAnswers: defineTable({
    userId: v.string(),
    projectId: v.id("projects"),
    questionId: v.string(),
    revisionId: v.string(),
    value: v.string(),
    unknown: v.boolean(),
    messageId: v.id("messages"),
  })
    .index("by_userId", ["userId"])
    .index("by_projectId", ["projectId"])
    .index("by_questionId", ["questionId"])
    .index("by_projectId_and_questionId_and_revisionId", [
      "projectId",
      "questionId",
      "revisionId",
    ]),

  jobs: defineTable({
    userId: v.string(),
    projectId: v.id("projects"),
    kind: v.string(),
    status: jobStatus,
    revisionId: v.string(),
    sourceMessageId: v.optional(v.id("messages")),
    retryOfJobId: v.optional(v.id("jobs")),
    attempt: v.optional(v.number()),
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
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_sourceMessageId", ["projectId", "sourceMessageId"]),

  planItems: defineTable({
    userId: v.string(),
    projectId: v.id("projects"),
    jobId: v.id("jobs"),
    revisionId: v.string(),
    sort: v.number(),
    talkingPoint: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_revisionId", ["projectId", "revisionId"]),

  slides: defineTable({
    userId: v.string(),
    projectId: v.id("projects"),
    jobId: v.id("jobs"),
    planItemId: v.id("planItems"),
    revisionId: v.string(),
    sort: v.number(),
    headline: v.string(),
    body: v.string(),
    placeholder: v.object({
      aspect: v.literal("9:16"),
      status: v.literal("empty"),
      description: v.string(),
    }),
  })
    .index("by_userId", ["userId"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_revisionId", ["projectId", "revisionId"]),

  questions: defineTable({
    questionId: v.string(),
    required: v.boolean(),
    sort: v.number(),
    title: v.string(),
  }).index("by_questionId", ["questionId"]),

  skills: defineTable({
    name: v.string(),
    version: v.number(),
    preconditions: v.array(v.string()),
    allowlistedTools: v.array(v.string()),
    bans: v.array(v.string()),
    promptFragment: v.string(),
  })
    .index("by_name", ["name"])
    .index("by_name_and_version", ["name", "version"]),
});
