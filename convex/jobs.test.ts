/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { authTables } from "@convex-dev/auth/server";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { QUESTION_CATALOG } from "./questions";
import * as jobs from "./jobs";
import * as messages from "./messages";
import * as projects from "./projects";
import * as questions from "./questions";
import * as users from "./users";
import * as brief from "./brief";
import * as plan from "./plan";
import { parseThreadState } from "./supervisorState";
import { listAvailableTools } from "./toolContracts";
import { buildEnvelope, MAIN_PROMPT } from "./supervisorPrompt";
import httpSource from "./http.ts?raw";
import authSource from "./auth.ts?raw";
import supervisorSource from "./supervisor.ts?raw";
import { assertPlanToolRuntimeArgs, assertSlidesToolRuntimeArgs } from "./supervisor";
import { validateSlides } from "./slides";

const modules = import.meta.glob("./**/*.ts");

function makeTest() {
  return convexTest(schema, modules);
}

async function insertUser(
  t: ReturnType<typeof makeTest>,
  profile: { name?: string; email?: string } = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: profile.name ?? "Основатель",
      email: profile.email ?? "founder@example.com",
    });
  });
}

function asUser(t: ReturnType<typeof makeTest>, userId: string) {
  return t.withIdentity({ subject: `${userId}|test-session` });
}

async function expectConvexCode(promise: Promise<unknown>, code: string) {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code}`).toBeDefined();
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  const data =
    thrown !== null &&
    typeof thrown === "object" &&
    "data" in thrown &&
    typeof thrown.data === "string"
      ? thrown.data
      : "";
  expect(`${message}${data}`).toContain(code);
}

function publicFunctions(mod: Record<string, unknown>) {
  return Object.entries(mod).filter(([, value]) => {
    const fn = value as { isConvexFunction?: boolean; isInternal?: boolean };
    return fn?.isConvexFunction === true && fn.isInternal !== true;
  });
}

test("schema has Epic 1 tables plus auth and no remotion/export/voice snapshots", () => {
  const tables = Object.keys(schema.tables).sort();
  expect(tables).toEqual(
    [
      ...Object.keys(authTables),
      "briefAnswers",
      "jobs",
      "messages",
      "planItems",
      "projects",
      "questions",
      "skills",
      "slides",
    ].sort(),
  );
  expect(tables.some((name) => /remotion|export|voice|snapshot/i.test(name))).toBe(
    false,
  );
});

test("public api is query/mutation only; auth is google plus http routes", () => {
  for (const [name, fn] of [
    ...publicFunctions(jobs),
    ...publicFunctions(messages),
    ...publicFunctions(projects),
    ...publicFunctions(questions),
    ...publicFunctions(brief),
    ...publicFunctions(plan),
    ...publicFunctions(users),
  ]) {
    const typed = fn as { isAction?: boolean; isHttpAction?: boolean };
    expect(typed.isAction, name).toBeFalsy();
    expect(typed.isHttpAction, name).toBeFalsy();
  }
  expect(jobs.runProbe.isInternal).toBe(true);
  expect(jobs.runProbe.isAction).toBe(true);
  expect(jobs.applyProbeResult.isInternal).toBe(true);
  expect(internal.jobs.runProbe).toBeDefined();
  expect(authSource).toContain("Google");
  expect(authSource).toContain("convexAuth");
  expect(httpSource).toContain("addHttpRoutes");
  expect(httpSource).not.toMatch(/\bhttpAction\b/);
});

test("guest is unauthenticated; users.me is null", async () => {
  const t = makeTest();
  expect(await t.query(api.users.me, {})).toBeNull();
  await expectConvexCode(t.query(api.questions.list, {}), "UNAUTHENTICATED");
  await expectConvexCode(t.mutation(api.questions.seed, {}), "UNAUTHENTICATED");
  await expectConvexCode(t.mutation(api.jobs.startProbe, {}), "UNAUTHENTICATED");
  await expectConvexCode(t.query(api.projects.current, {}), "UNAUTHENTICATED");
  await expectConvexCode(t.mutation(api.projects.ensure, {}), "UNAUTHENTICATED");

  const ids = await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      userId: "other",
      kind: "probe",
      status: "empty",
      createdAt: Date.now(),
    });
    const jobId = await ctx.db.insert("jobs", {
      userId: "other",
      projectId,
      kind: "probe",
      status: "queued",
      revisionId: "rev_guest",
      createdAt: Date.now(),
    });
    return { projectId, jobId };
  });
  await expectConvexCode(
    t.query(api.jobs.get, { jobId: ids.jobId }),
    "UNAUTHENTICATED",
  );
  await expectConvexCode(
    t.query(api.projects.get, { projectId: ids.projectId }),
    "UNAUTHENTICATED",
  );
});

test("seed is idempotent and marks q_proof optional", async () => {
  const t = makeTest();
  const userId = String(await insertUser(t));
  const authed = asUser(t, userId);
  const first = await authed.mutation(api.questions.seed, {});
  const second = await authed.mutation(api.questions.seed, {});
  expect(first).toHaveLength(6);
  expect(second).toEqual(first);

  const list = await authed.query(api.questions.list, {});
  expect(list.map((row) => row.questionId)).toEqual(
    QUESTION_CATALOG.map((row) => row.questionId),
  );
  const proof = list.find((row) => row.questionId === "q_proof");
  expect(proof?.required).toBe(false);
  expect(list.filter((row) => row.required).map((row) => row.questionId)).toEqual(
    QUESTION_CATALOG.filter((row) => row.required).map((row) => row.questionId),
  );
});

test("own startProbe uses session userId and own get succeeds", async () => {
  const t = makeTest();
  vi.useFakeTimers();
  const userId = String(
    await insertUser(t, { name: "Анна", email: "anna@example.com" }),
  );
  const authed = asUser(t, userId);
  const me = await authed.query(api.users.me, {});
  expect(me?.name).toBe("Анна");
  expect(me?.email).toBe("anna@example.com");

  const started = await authed.mutation(api.jobs.startProbe, {});
  expect(started.userId).toBe(userId);
  expect(started.userId).not.toBe("probe");

  const job = await authed.query(api.jobs.get, { jobId: started.jobId });
  const project = await authed.query(api.projects.get, {
    projectId: started.projectId,
  });

  expect(job?.status).toBe("queued");
  expect(job?.kind).toBe("probe");
  expect(job?.userId).toBe(userId);
  expect(project?.kind).toBe("probe");
  expect(project?.userId).toBe(userId);
  expect(project?.currentJobId).toBe(started.jobId);
  expect(project?.currentRevisionId).toBe(started.revisionId);

  await t.finishAllScheduledFunctions(() => {
    vi.runAllTimers();
  });

  const done = await authed.query(api.jobs.get, { jobId: started.jobId });
  expect(done?.status).toBe("succeeded");
  expect(done?.ranWith).toEqual({
    userId: started.userId,
    projectId: started.projectId,
    jobId: started.jobId,
    revisionId: started.revisionId,
  });
  vi.useRealTimers();
});

test("foreign job and project ids are NOT_FOUND, not UNAUTHENTICATED", async () => {
  const t = makeTest();
  vi.useFakeTimers();
  const ownerId = String(await insertUser(t, { email: "a@example.com" }));
  const strangerId = String(await insertUser(t, { email: "b@example.com" }));
  const owner = asUser(t, ownerId);
  const stranger = asUser(t, strangerId);

  const started = await owner.mutation(api.jobs.startProbe, {});

  await expectConvexCode(
    stranger.query(api.jobs.get, { jobId: started.jobId }),
    "NOT_FOUND",
  );
  await expectConvexCode(
    stranger.query(api.projects.get, { projectId: started.projectId }),
    "NOT_FOUND",
  );

  let foreignError: unknown;
  try {
    await stranger.query(api.jobs.get, { jobId: started.jobId });
  } catch (error) {
    foreignError = error;
  }
  expect(foreignError).toBeDefined();
  const foreignMessage =
    foreignError instanceof Error ? foreignError.message : String(foreignError);
  expect(foreignMessage).not.toContain("UNAUTHENTICATED");

  await t.finishAllScheduledFunctions(() => {
    vi.runAllTimers();
  });
  vi.useRealTimers();
});

test("two sessions startProbe keep separate projects and current jobs", async () => {
  const t = makeTest();
  vi.useFakeTimers();
  const ownerId = String(await insertUser(t, { email: "a@example.com" }));
  const strangerId = String(await insertUser(t, { email: "b@example.com" }));
  const owner = asUser(t, ownerId);
  const stranger = asUser(t, strangerId);

  const first = await owner.mutation(api.jobs.startProbe, {});
  const second = await stranger.mutation(api.jobs.startProbe, {});
  expect(first.projectId).not.toBe(second.projectId);
  expect(first.jobId).not.toBe(second.jobId);

  const ownerJob = await owner.query(api.jobs.get, { jobId: first.jobId });
  const ownerProject = await owner.query(api.projects.get, {
    projectId: first.projectId,
  });
  const strangerJob = await stranger.query(api.jobs.get, {
    jobId: second.jobId,
  });
  const strangerProject = await stranger.query(api.projects.get, {
    projectId: second.projectId,
  });
  expect(ownerJob?.userId).toBe(ownerId);
  expect(ownerProject?.userId).toBe(ownerId);
  expect(strangerJob?.userId).toBe(strangerId);
  expect(strangerProject?.userId).toBe(strangerId);
  expect(ownerProject?.currentJobId).toBe(first.jobId);
  expect(strangerProject?.currentJobId).toBe(second.jobId);

  await t.finishAllScheduledFunctions(() => {
    vi.runAllTimers();
  });
  vi.useRealTimers();
});

test("late job does not overwrite the current revision", async () => {
  const t = makeTest();
  vi.useFakeTimers();
  const userId = String(await insertUser(t));
  const authed = asUser(t, userId);
  const first = await authed.mutation(api.jobs.startProbe, {});
  const second = await authed.mutation(api.jobs.startProbe, {});
  expect(first.projectId).toBe(second.projectId);
  expect(first.jobId).not.toBe(second.jobId);

  await t.finishAllScheduledFunctions(() => {
    vi.runAllTimers();
  });

  const project = await authed.query(api.projects.get, {
    projectId: second.projectId,
  });
  expect(project?.currentJobId).toBe(second.jobId);
  expect(project?.currentRevisionId).toBe(second.revisionId);

  const stale = await authed.query(api.jobs.get, { jobId: first.jobId });
  const current = await authed.query(api.jobs.get, { jobId: second.jobId });
  expect(stale?.status).toBe("queued");
  expect(stale?.ranWith).toBeUndefined();
  expect(current?.status).toBe("succeeded");
  vi.useRealTimers();
});

test("failed probe stays failed without auto-retry", async () => {
  const t = makeTest();
  vi.useFakeTimers();
  const userId = String(await insertUser(t));
  const authed = asUser(t, userId);
  const started = await authed.mutation(api.jobs.startProbe, { fail: true });

  await t.finishAllScheduledFunctions(() => {
    vi.runAllTimers();
  });

  const failed = await authed.query(api.jobs.get, { jobId: started.jobId });
  expect(failed?.status).toBe("failed");
  expect(failed?.error).toBe("probe_failed");

  const afterFail = await t.run(async (ctx) => ctx.db.query("jobs").collect());
  expect(afterFail).toHaveLength(1);

  const retry = await authed.mutation(api.jobs.startProbe, {});
  expect(retry.jobId).not.toBe(started.jobId);
  expect(retry.userId).toBe(userId);

  const afterRetry = await t.run(async (ctx) => ctx.db.query("jobs").collect());
  expect(afterRetry).toHaveLength(2);
  vi.useRealTimers();
});

test("ensure creates one product; current is stable; foreign get is NOT_FOUND", async () => {
  const t = makeTest();
  await expectConvexCode(t.query(api.projects.current, {}), "UNAUTHENTICATED");
  await expectConvexCode(t.mutation(api.projects.ensure, {}), "UNAUTHENTICATED");

  const ownerId = String(await insertUser(t, { email: "a@example.com" }));
  const strangerId = String(await insertUser(t, { email: "b@example.com" }));
  const owner = asUser(t, ownerId);
  const stranger = asUser(t, strangerId);

  expect(await owner.query(api.projects.current, {})).toBeNull();

  const first = await owner.mutation(api.projects.ensure, {});
  expect(first.kind).toBe("product");
  expect(first.status).toBe("empty");
  expect(first.userId).toBe(ownerId);
  expect(first.currentRevisionId).toMatch(/^rev_\d+_[a-z0-9]+$/);

  const again = await owner.mutation(api.projects.ensure, {});
  expect(again._id).toBe(first._id);
  expect(again.currentRevisionId).toBe(first.currentRevisionId);

  const [left, right] = await Promise.all([
    owner.mutation(api.projects.ensure, {}),
    owner.mutation(api.projects.ensure, {}),
  ]);
  expect(left._id).toBe(first._id);
  expect(right._id).toBe(first._id);

  const current = await owner.query(api.projects.current, {});
  expect(current?._id).toBe(first._id);
  expect(current?.status).toBe("empty");
  expect(current?.currentRevisionId).toBe(first.currentRevisionId);

  const products = await t.run(async (ctx) => {
    return (await ctx.db.query("projects").collect()).filter(
      (row) => row.userId === ownerId && row.kind === "product",
    );
  });
  expect(products).toHaveLength(1);

  await expectConvexCode(
    stranger.query(api.projects.get, { projectId: first._id }),
    "NOT_FOUND",
  );
});

test("messages persist trimmed, ordered, idempotent, validated, and owner-only", async () => {
  const t = makeTest();
  vi.useFakeTimers();
  const ownerId = String(await insertUser(t, { email: "owner@example.com" }));
  const strangerId = String(await insertUser(t, { email: "other@example.com" }));
  const owner = asUser(t, ownerId);
  const stranger = asUser(t, strangerId);
  const project = await owner.mutation(api.projects.ensure, {});

  await expectConvexCode(
    t.query(api.messages.list, { projectId: project._id }),
    "UNAUTHENTICATED",
  );
  await expectConvexCode(
    stranger.query(api.messages.list, { projectId: project._id }),
    "NOT_FOUND",
  );
  await expectConvexCode(
    stranger.mutation(api.messages.send, {
      projectId: project._id,
      body: "Hello",
      clientMessageId: "foreign",
    }),
    "NOT_FOUND",
  );
  await expectConvexCode(
    owner.mutation(api.messages.send, {
      projectId: project._id,
      body: "   ",
      clientMessageId: "empty",
    }),
    "MESSAGE_EMPTY",
  );
  await expectConvexCode(
    owner.mutation(api.messages.send, {
      projectId: project._id,
      body: "x".repeat(4001),
      clientMessageId: "long",
    }),
    "MESSAGE_TOO_LONG",
  );

  const first = await owner.mutation(api.messages.send, {
    projectId: project._id,
    body: "  Hello  ",
    clientMessageId: "client-1",
  });
  const retry = await owner.mutation(api.messages.send, {
    projectId: project._id,
    body: "different retry body",
    clientMessageId: "client-1",
  });
  expect(retry.message._id).toBe(first.message._id);
  expect(retry.job?._id).toBe(first.job?._id);
  expect(retry.message.body).toBe("Hello");

  await owner.mutation(api.messages.send, {
    projectId: project._id,
    body: "Second",
    clientMessageId: "client-2",
  });
  const list = await owner.query(api.messages.list, { projectId: project._id });
  expect(list.map((message) => message.body)).toEqual(["Hello", "Second"]);
  expect(list).toHaveLength(2);

  const updated = await owner.query(api.projects.get, { projectId: project._id });
  const threadId = updated.langgraphThreadId;
  expect(threadId).toMatch(/^thread_/);
  await owner.mutation(api.messages.send, {
    projectId: project._id,
    body: "Third",
    clientMessageId: "client-3",
  });
  expect(
    (await owner.query(api.projects.get, { projectId: project._id }))
      .langgraphThreadId,
  ).toBe(threadId);

  const allRows = await t.run(async (ctx) => ctx.db.query("messages").collect());
  expect(allRows).toHaveLength(3);
  const supervisorJobs = await t.run(async (ctx) =>
    (await ctx.db.query("jobs").collect()).filter((job) => job.kind === "supervisor"),
  );
  expect(supervisorJobs).toHaveLength(3);
  expect(supervisorJobs.every((job) => job.status === "queued" && job.sourceMessageId)).toBe(true);
  vi.clearAllTimers();
  vi.useRealTimers();
});

test("failed supervisor Retry links one new attempt to the same user message", async () => {
  const t = makeTest();
  vi.useFakeTimers();
  const userId = String(await insertUser(t));
  const owner = asUser(t, userId);
  const project = await owner.mutation(api.projects.ensure, {});
  const sent = await owner.mutation(api.messages.send, {
    projectId: project._id,
    body: "Make me a deck",
    clientMessageId: "retry-turn",
  });
  await t.mutation(internal.jobs.failSupervisor, {
    userId,
    projectId: project._id,
    jobId: sent.job!._id,
    revisionId: sent.job!.revisionId,
    sourceMessageId: sent.message._id,
    error: "SUPERVISOR_FAILED",
  });

  const retry = await owner.mutation(api.jobs.retrySupervisor, { jobId: sent.job!._id });
  expect(retry?.retryOfJobId).toBe(sent.job!._id);
  expect(retry?.sourceMessageId).toBe(sent.message._id);
  expect(retry?.attempt).toBe(2);
  expect((await owner.query(api.messages.list, { projectId: project._id }))).toHaveLength(1);
  const resend = await owner.mutation(api.messages.send, {
    projectId: project._id,
    body: "ignored resend body",
    clientMessageId: "retry-turn",
  });
  expect(resend.message._id).toBe(sent.message._id);
  expect(resend.job?._id).toBe(sent.job?._id);
  vi.clearAllTimers();
  vi.useRealTimers();
});

test("supervisor smoke covers completion, control state, invalid state, and safe failure", async () => {
  const t = makeTest();
  vi.useFakeTimers();
  const userId = String(await insertUser(t));
  const owner = asUser(t, userId);
  const project = await owner.mutation(api.projects.ensure, {});

  const successful = await owner.mutation(api.messages.send, {
    projectId: project._id, body: "Hello", clientMessageId: "success",
  });
  const successfulArgs = {
    userId, projectId: project._id, jobId: successful.job!._id,
    revisionId: successful.job!.revisionId, sourceMessageId: successful.message._id,
  };
  await t.mutation(internal.jobs.loadSupervisorTurn, successfulArgs);
  await t.mutation(internal.jobs.completeSupervisor, { ...successfulArgs, body: "Hi." });
  expect((await owner.query(api.jobs.get, { jobId: successful.job!._id }))?.status).toBe("succeeded");
  expect((await owner.query(api.messages.list, { projectId: project._id })).at(-1)?.body).toBe("Hi.");

  const control = await owner.mutation(api.messages.send, {
    projectId: project._id, body: "Make a deck", clientMessageId: "control",
  });
  const controlArgs = {
    userId, projectId: project._id, jobId: control.job!._id,
    revisionId: control.job!.revisionId, sourceMessageId: control.message._id,
  };
  await t.mutation(internal.jobs.loadSupervisorTurn, controlArgs);
  await t.mutation(internal.supervisorState.offerSkill, {
    userId, projectId: project._id, jobId: control.job!._id,
    skill: "presentation_onboarding",
  });
  const pending = parseThreadState((await owner.query(api.projects.get, { projectId: project._id })).langgraphThreadState);
  expect(pending.pendingIntent).toBe("offer_skill:presentation_onboarding");
  expect(listAvailableTools(pending)).toEqual(["offer_skill", "accept_skill_offer", "clear_skill"]);
  expect(parseThreadState((await owner.query(api.projects.get, { projectId: project._id })).langgraphThreadState)).toEqual(pending);
  await owner.mutation(api.supervisorState.acceptSkillOffer, { projectId: project._id });
  const active = parseThreadState((await owner.query(api.projects.get, { projectId: project._id })).langgraphThreadState);
  expect(active.activeSkill).toBe("presentation_onboarding");
  expect(listAvailableTools(active)).toEqual(["clear_skill", "save_brief_answer", "mark_unknown"]);
  await t.mutation(internal.supervisorState.clearSkill, {
    userId, projectId: project._id, jobId: control.job!._id,
  });
  expect(parseThreadState((await owner.query(api.projects.get, { projectId: project._id })).langgraphThreadState).activeSkill).toBeNull();
  expect(() => parseThreadState({ schemaVersion: 2 })).toThrow(/INVALID_THREAD_STATE/);

  const invalid = await owner.mutation(api.messages.send, {
    projectId: project._id, body: "Broken state", clientMessageId: "invalid-state",
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(project._id, { langgraphThreadState: { schemaVersion: 2 } });
  });
  await t.action(internal.supervisor.runSupervisor, {
    userId, projectId: project._id, jobId: invalid.job!._id,
    revisionId: invalid.job!.revisionId, sourceMessageId: invalid.message._id,
  });
  const invalidJob = await owner.query(api.jobs.get, { jobId: invalid.job!._id });
  expect(invalidJob?.status).toBe("failed");
  expect(invalidJob?.error).toBe("INVALID_THREAD_STATE");
  await t.run(async (ctx) => {
    await ctx.db.patch(project._id, { langgraphThreadState: undefined });
  });

  const failing = await owner.mutation(api.messages.send, {
    projectId: project._id, body: "Provider failure", clientMessageId: "failure",
  });
  await t.action(internal.supervisor.runSupervisor, {
    userId, projectId: project._id, jobId: failing.job!._id,
    revisionId: failing.job!.revisionId, sourceMessageId: failing.message._id,
  });
  const failed = await owner.query(api.jobs.get, { jobId: failing.job!._id });
  expect(failed?.status).toBe("failed");
  expect(failed?.error).toBe("SUPERVISOR_FAILED");
  vi.clearAllTimers();
  vi.useRealTimers();
});

test("onboarding saves provenance, forks corrections, and confirms without a plan job", async () => {
  const t = makeTest();
  vi.useFakeTimers();
  const userId = String(await insertUser(t));
  const owner = asUser(t, userId);
  const project = await owner.mutation(api.projects.ensure, {});
  const sent = await owner.mutation(api.messages.send, {
    projectId: project._id,
    body: "Our product helps founders",
    clientMessageId: "onboarding",
  });
  const runtime = {
    userId,
    projectId: project._id,
    jobId: sent.job!._id,
    sourceMessageId: sent.message._id,
  };
  await t.mutation(internal.jobs.loadSupervisorTurn, {
    ...runtime,
    revisionId: sent.job!.revisionId,
  });
  await t.mutation(internal.supervisorState.offerSkill, {
    userId,
    projectId: project._id,
    jobId: sent.job!._id,
    skill: "presentation_onboarding",
  });
  await owner.mutation(api.supervisorState.acceptSkillOffer, { projectId: project._id });
  await expectConvexCode(
    owner.mutation(api.brief.confirmBrief, { projectId: project._id, revisionId: project.currentRevisionId! }),
    "BRIEF_INCOMPLETE",
  );
  await expectConvexCode(
    t.mutation(internal.brief.saveBriefAnswer, { ...runtime, questionId: "q_missing", value: "No" }),
    "BRIEF_QUESTION_UNKNOWN",
  );
  await expectConvexCode(
    t.mutation(internal.brief.saveBriefAnswer, { ...runtime, questionId: "q_one_liner", value: "   " }),
    "TOOL_ARGS_INVALID",
  );
  await expectConvexCode(
    t.mutation(internal.brief.saveBriefAnswer, { ...runtime, questionId: "q_one_liner", value: "x".repeat(4001) }),
    "MESSAGE_TOO_LONG",
  );

  await t.mutation(internal.brief.saveBriefAnswer, {
    ...runtime,
    questionId: "q_one_liner",
    value: "A pitch assistant",
  });
  await owner.mutation(api.supervisorState.clearSkillForUser, { projectId: project._id });
  const stopped = await owner.query(api.brief.progress, { projectId: project._id });
  expect(stopped.answers.map((answer) => answer.questionId)).toEqual(["q_one_liner"]);
  expect(stopped.state.activeSkill).toBeNull();
  await t.mutation(internal.supervisorState.offerSkill, {
    userId,
    projectId: project._id,
    jobId: sent.job!._id,
    skill: "presentation_onboarding",
  });
  await owner.mutation(api.supervisorState.acceptSkillOffer, { projectId: project._id });
  const resumed = await owner.query(api.brief.progress, { projectId: project._id });
  expect(resumed.answers.map((answer) => answer.questionId)).toEqual(["q_one_liner"]);
  expect(resumed.nextQuestion?.questionId).toBe("q_audience");
  const resumedEnvelope = buildEnvelope(
    await owner.query(api.projects.get, { projectId: project._id }),
    resumed.state,
    resumed.complete,
    resumed.answers,
  );
  expect(resumedEnvelope.text.indexOf("</envelope>")).toBeLessThan(resumedEnvelope.text.indexOf("You are running presentation_onboarding"));
  expect(resumedEnvelope.text).toContain("Ask exactly one unanswered catalog question per turn");
  expect(resumedEnvelope.text).toContain("A side question is not an answer");
  expect(resumedEnvelope.text).toContain('"questionId":"q_one_liner"');
  expect(MAIN_PROMPT).toContain("There is no word list and no activate_skill");

  for (const [questionId, value] of [
    ["q_audience", "Startup founders"],
    ["q_problem", "Decks take too long"],
    ["q_difference", "Conversation first"],
    ["q_cta", "Book a demo"],
  ]) {
    await t.mutation(internal.brief.saveBriefAnswer, { ...runtime, questionId, value });
  }
  await t.mutation(internal.brief.markUnknown, { ...runtime, questionId: "q_proof" });
  const before = await owner.query(api.brief.progress, { projectId: project._id });
  expect(before.complete).toBe(true);
  expect(before.closedCount).toBe(6);
  expect(before.answers.every((answer) => answer.messageId === sent.message._id)).toBe(true);
  expect(before.answers.find((answer) => answer.questionId === "q_proof")).toMatchObject({ unknown: true, value: "" });
  expect(listAvailableTools(before.state, before.complete)).toContain("confirm_brief");

  await t.mutation(internal.brief.saveBriefAnswer, { ...runtime, questionId: "q_cta", value: "Join the waitlist" });
  const corrected = await owner.query(api.brief.progress, { projectId: project._id });
  expect(corrected.revisionId).not.toBe(before.revisionId);
  expect(corrected.answers).toHaveLength(6);
  const oldRows = await t.run(async (ctx) => (await ctx.db.query("briefAnswers").collect()).filter((row) => row.revisionId === before.revisionId));
  expect(oldRows.find((answer) => answer.questionId === "q_cta")?.value).toBe("Book a demo");

  await owner.mutation(api.brief.confirmBrief, { projectId: project._id, revisionId: corrected.revisionId });
  const confirmed = await owner.query(api.projects.get, { projectId: project._id });
  expect(confirmed.status).toBe("brief_ready");
  expect(confirmed.confirmedBriefRevisionId).toBe(corrected.revisionId);
  expect(parseThreadState(confirmed.langgraphThreadState).activeSkill).toBeNull();
  expect((await t.run(async (ctx) => ctx.db.query("jobs").collect())).filter((job) => job.kind !== "supervisor")).toHaveLength(0);
  vi.clearAllTimers();
  vi.useRealTimers();
});

test("presentation plan is gated, idempotent, ordered, retryable, and stale-safe", async () => {
  const t = makeTest();
  vi.useFakeTimers();
  const userId = String(await insertUser(t));
  const owner = asUser(t, userId);
  const project = await owner.mutation(api.projects.ensure, {});
  await expectConvexCode(owner.mutation(api.plan.generate, {
    projectId: project._id, confirmedBriefRevisionId: project.currentRevisionId!,
  }), "TOOL_NOT_AVAILABLE");
  const briefRevisionId = "brief_confirmed";
  await t.run(async (ctx) => {
    await ctx.db.patch(project._id, { status: "brief_ready", confirmedBriefRevisionId: briefRevisionId });
    await ctx.db.insert("briefAnswers", {
      userId, projectId: project._id, questionId: "q_one_liner", revisionId: briefRevisionId,
      value: "A factual pitch assistant", unknown: false, messageId: await ctx.db.insert("messages", {
        userId, projectId: project._id, role: "user", body: "A factual pitch assistant", createdAt: Date.now(),
      }),
    });
  });
  const ready = await owner.query(api.projects.get, { projectId: project._id });
  const idleState = parseThreadState(ready.langgraphThreadState);
  expect(listAvailableTools(idleState, false, ready.status, ready.confirmedBriefRevisionId)).toContain("generate_presentation_plan");
  const envelope = buildEnvelope(ready, idleState);
  expect(envelope.text).toContain(`project_id: ${project._id}`);
  expect(envelope.text).toContain(`confirmed_brief_revision_id: ${briefRevisionId}`);
  expect(envelope.text).toContain(JSON.stringify({ projectId: project._id, confirmedBriefRevisionId: briefRevisionId }));
  expect(supervisorSource).toContain('required: ["projectId", "confirmedBriefRevisionId"]');
  expect(() => assertPlanToolRuntimeArgs(
    { projectId: String(project._id), confirmedBriefRevisionId: "wrong_revision" },
    { projectId: String(project._id), confirmedBriefRevisionId: briefRevisionId },
  )).toThrow("TOOL_ARGS_INVALID");
  expect(() => assertPlanToolRuntimeArgs(
    { projectId: String(project._id), confirmedBriefRevisionId: briefRevisionId },
    { projectId: String(project._id), confirmedBriefRevisionId: briefRevisionId },
  )).not.toThrow();

  const first = await owner.mutation(api.plan.generate, { projectId: project._id, confirmedBriefRevisionId: briefRevisionId });
  const duplicate = await owner.mutation(api.plan.generate, { projectId: project._id, confirmedBriefRevisionId: briefRevisionId });
  expect(duplicate?._id).toBe(first?._id);
  const queuedProject = await owner.query(api.projects.get, { projectId: project._id });
  const firstArgs = {
    userId, projectId: project._id, jobId: first!._id, briefRevisionId,
    planRevisionId: queuedProject.currentPlanRevisionId!,
  };
  await t.mutation(internal.plan.load, firstArgs);
  await expectConvexCode(t.mutation(internal.plan.apply, { ...firstArgs, items: [] }), "PLAN_INVALID");
  await t.mutation(internal.plan.fail, firstArgs);
  expect((await owner.query(api.plan.current, { projectId: project._id })).job?.error).toBe("PLAN_GENERATION_FAILED");

  const retry = await owner.mutation(api.plan.retry, { jobId: first!._id });
  expect(retry?.retryOfJobId).toBe(first?._id);
  const retryProject = await owner.query(api.projects.get, { projectId: project._id });
  expect(await t.mutation(internal.plan.apply, { ...firstArgs, items: [{ talkingPoint: "Late" }] })).toEqual({ applied: false });
  expect(retryProject.currentPlanJobId).toBe(retry?._id);
  const retryArgs = { ...firstArgs, jobId: retry!._id, planRevisionId: retryProject.currentPlanRevisionId! };
  await t.mutation(internal.plan.load, retryArgs);
  await t.mutation(internal.plan.apply, { ...retryArgs, items: [{ talkingPoint: "Problem" }, { talkingPoint: "Solution" }] });
  const done = await owner.query(api.plan.current, { projectId: project._id });
  expect(done.job?.status).toBe("succeeded");
  expect(done.items.map(({ sort, talkingPoint, jobId }) => ({ sort, talkingPoint, jobId }))).toEqual([
    { sort: 0, talkingPoint: "Problem", jobId: retry!._id },
    { sort: 1, talkingPoint: "Solution", jobId: retry!._id },
  ]);
  expect((await owner.query(api.projects.get, { projectId: project._id })).status).toBe("plan_ready");
  vi.clearAllTimers();
  vi.useRealTimers();
});

test("slides are gated, validated, atomically published, retryable, and stale-safe", async () => {
  const t = makeTest();
  vi.useFakeTimers();
  const userId = String(await insertUser(t));
  const owner = asUser(t, userId);
  const project = await owner.mutation(api.projects.ensure, {});
  await expectConvexCode(owner.mutation(api.slides.generate, {
    projectId: project._id, planRevisionId: "not-ready",
  }), "TOOL_NOT_AVAILABLE");
  const planRevisionId = "plan_ready_revision";
  await t.run(async (ctx) => {
    const sourceMessageId = await ctx.db.insert("messages", {
      userId, projectId: project._id, role: "user", body: "Confirmed facts", createdAt: Date.now(),
    });
    await ctx.db.insert("briefAnswers", {
      userId, projectId: project._id, questionId: "q_one_liner", revisionId: "brief_ready_revision",
      value: "Helps café owners plan shifts", unknown: false, messageId: sourceMessageId,
    });
    await ctx.db.patch(project._id, {
      status: "plan_ready", confirmedBriefRevisionId: "brief_ready_revision", currentPlanRevisionId: planRevisionId,
    });
    const jobId = await ctx.db.insert("jobs", {
      userId, projectId: project._id, kind: "presentation_plan", status: "succeeded",
      revisionId: "brief_ready_revision", createdAt: Date.now(),
    });
    return await Promise.all(["Problem", "Solution"].map((talkingPoint, sort) => ctx.db.insert("planItems", {
      userId, projectId: project._id, jobId, revisionId: planRevisionId, sort, talkingPoint,
    })));
  });
  const ready = await owner.query(api.projects.get, { projectId: project._id });
  const idle = parseThreadState(ready.langgraphThreadState);
  expect(listAvailableTools(idle, false, ready.status, ready.confirmedBriefRevisionId)).toContain("generate_slides");
  expect(listAvailableTools({ ...idle, pendingIntent: "offer_skill:presentation_onboarding" }, false, ready.status, ready.confirmedBriefRevisionId))
    .not.toContain("generate_slides");
  expect(listAvailableTools({ ...idle, activeSkill: "presentation_onboarding", skillVersion: 1 }, false, ready.status, ready.confirmedBriefRevisionId))
    .not.toContain("generate_slides");
  const envelope = buildEnvelope(ready, idle);
  expect(envelope.text).toContain(JSON.stringify({ projectId: project._id, planRevisionId }));
  expect(() => assertSlidesToolRuntimeArgs(
    { projectId: String(project._id), planRevisionId: "wrong" },
    { projectId: String(project._id), planRevisionId },
  )).toThrow("TOOL_ARGS_INVALID");

  const first = await owner.mutation(api.slides.generate, { projectId: project._id, planRevisionId });
  const duplicate = await owner.mutation(api.slides.generate, { projectId: project._id, planRevisionId });
  expect(duplicate?._id).toBe(first?._id);
  const queued = await owner.query(api.projects.get, { projectId: project._id });
  const firstArgs = {
    userId, projectId: project._id, jobId: first!._id, planRevisionId,
    slidesRevisionId: queued.currentSlidesRevisionId!,
  };
  const loaded = await t.mutation(internal.slides.load, firstArgs);
  expect(loaded.planItems.map((item) => item.talkingPoint)).toEqual(["Problem", "Solution"]);
  const validSlides = loaded.planItems.map((item) => ({
    planItemId: item._id, sort: item.sort, headline: "Headline", body: "Body",
    placeholder: { aspect: "9:16", status: "empty", description: "Visual" },
  }));
  function withField(field: "headline" | "body" | "placeholder.description", value: unknown) {
    const candidate = structuredClone(validSlides) as Array<Record<string, unknown>>;
    if (field === "placeholder.description") {
      (candidate[0].placeholder as Record<string, unknown>).description = value;
    } else {
      candidate[0][field] = value;
    }
    return candidate;
  }
  for (const [field, max] of [["headline", 120], ["body", 700], ["placeholder.description", 1000]] as const) {
    expect(validateSlides(withField(field, ` ${"x".repeat(max)} `), loaded.planItems)[0])
      .toMatchObject(field === "placeholder.description"
        ? { placeholder: { description: "x".repeat(max) } }
        : { [field]: "x".repeat(max) });
    expect(() => validateSlides(withField(field, "😀".repeat(max)), loaded.planItems)).not.toThrow();
    for (const invalidValue of ["x".repeat(max + 1), "   ", null, undefined, 42]) {
      expect(() => validateSlides(withField(field, invalidValue), loaded.planItems))
        .toThrow(new RegExp(`SLIDE_CONTENT_INVALID.*field=${field.replace(".", "\\.")}`));
    }
  }
  expect(() => validateSlides(withField("headline", "x").map((slide, index) =>
    index === 0 ? { ...slide, planItemId: String(project._id) } : slide), loaded.planItems))
    .toThrow(/SLIDE_CONTENT_INVALID.*field=planItemId/);
  expect(() => validateSlides(withField("headline", "x").map((slide, index) =>
    index === 0 ? { ...slide, sort: 1 } : slide), loaded.planItems))
    .toThrow(/SLIDE_CONTENT_INVALID.*field=sort/);

  await expectConvexCode(t.mutation(internal.slides.apply, {
    ...firstArgs,
    slides: validSlides.map((slide, index) => index === 0 ? { ...slide, headline: "x".repeat(121) } : slide),
  }), "SLIDE_CONTENT_INVALID:slide=1:field=headline");
  await t.mutation(internal.slides.fail, { ...firstArgs, error: "SLIDE_CONTENT_INVALID:slide=1:field=headline" });
  expect((await owner.query(api.slides.current, { projectId: project._id })).job?.error)
    .toBe("SLIDE_CONTENT_INVALID:slide=1:field=headline");
  expect(await t.run(async (ctx) => ctx.db.query("slides").collect())).toHaveLength(0);

  const retry = await owner.mutation(api.slides.retry, { jobId: first!._id });
  const retryProject = await owner.query(api.projects.get, { projectId: project._id });
  expect(await t.mutation(internal.slides.apply, { ...firstArgs, slides: [] })).toEqual({ applied: false });
  const retryArgs = { ...firstArgs, jobId: retry!._id, slidesRevisionId: retryProject.currentSlidesRevisionId! };
  await t.mutation(internal.slides.load, retryArgs);
  const valid = loaded.planItems.map((item) => ({
    planItemId: item._id, sort: item.sort, headline: ` Headline ${item.sort + 1} `, body: "Body",
    placeholder: { aspect: "9:16" as const, status: "empty" as const, description: "Process diagram" },
  }));
  await t.mutation(internal.slides.apply, { ...retryArgs, slides: valid });
  const done = await owner.query(api.slides.current, { projectId: project._id });
  expect(done.job?.status).toBe("succeeded");
  expect(done.slides.map(({ sort, headline, jobId }) => ({ sort, headline, jobId }))).toEqual([
    { sort: 0, headline: "Headline 1", jobId: retry!._id },
    { sort: 1, headline: "Headline 2", jobId: retry!._id },
  ]);
  expect((await owner.query(api.projects.get, { projectId: project._id })).status).toBe("slides_ready");
  vi.clearAllTimers();
  vi.useRealTimers();
});
