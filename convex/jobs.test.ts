/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { authTables } from "@convex-dev/auth/server";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { QUESTION_CATALOG } from "./questions";
import * as jobs from "./jobs";
import * as projects from "./projects";
import * as questions from "./questions";
import * as users from "./users";
import httpSource from "./http.ts?raw";
import authSource from "./auth.ts?raw";

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
    ...publicFunctions(projects),
    ...publicFunctions(questions),
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
