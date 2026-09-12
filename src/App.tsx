import { useEffect, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  AUTH_RETURN_PARAM,
  identityLabel,
  returnedOAuthError,
  SAFE_SIGN_IN_ERROR,
} from "./authUi.ts";

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const questions = useQuery(api.questions.list, isAuthenticated ? {} : "skip");
  const seed = useMutation(api.questions.seed);
  const startProbe = useMutation(api.jobs.startProbe);
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null);
  const [jobId, setJobId] = useState<Id<"jobs"> | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const project = useQuery(
    api.projects.get,
    isAuthenticated && projectId ? { projectId } : "skip",
  );
  const job = useQuery(
    api.jobs.get,
    isAuthenticated && jobId ? { jobId } : "skip",
  );

  useEffect(() => {
    if (isLoading) {
      return;
    }
    const search = window.location.search;
    const message = returnedOAuthError(search, isAuthenticated);
    if (message) {
      setAuthError(message);
    }
    const url = new URL(window.location.href);
    if (
      url.searchParams.has(AUTH_RETURN_PARAM) ||
      url.searchParams.has("error") ||
      url.searchParams.has("error_description")
    ) {
      url.searchParams.delete(AUTH_RETURN_PARAM);
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      window.history.replaceState(
        {},
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    if (isAuthenticated) {
      return;
    }
    setProjectId(null);
    setJobId(null);
    setActionError(null);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    void seed({}).catch((error) => {
      setSeedError(
        error instanceof Error ? error.message : "Не удалось выполнить seed",
      );
    });
  }, [isAuthenticated, seed]);

  async function retryProbe() {
    setPending(true);
    setActionError(null);
    try {
      const started = await startProbe({});
      setProjectId(started.projectId);
      setJobId(started.jobId);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Не удалось запустить probe",
      );
    } finally {
      setPending(false);
    }
  }

  async function handleSignIn() {
    setAuthError(null);
    try {
      await signIn("google", { redirectTo: `?${AUTH_RETURN_PARAM}=1` });
    } catch {
      setAuthError(SAFE_SIGN_IN_ERROR);
    }
  }

  async function handleSignOut() {
    await signOut();
    setProjectId(null);
    setJobId(null);
    setActionError(null);
    setSeedError(null);
    setAuthError(null);
  }

  if (isLoading) {
    return (
      <main className="page">
        <p>Загрузка сессии…</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="page">
        <h1>Вход</h1>
        <p className="lede">
          Без сессии доступен только вход. Служебный probe откроется после
          Google.
        </p>
        {authError ? <p className="error">{authError}</p> : null}
        <button type="button" onClick={() => void handleSignIn()}>
          Войти через Google
        </button>
      </main>
    );
  }

  const label = identityLabel(me);

  return (
    <main className="page">
      <p className="eyebrow">Служебный probe</p>
      <h1>Контракт Convex</h1>
      <p className="lede">
        Каталог вопросов и статус служебного probe-job. Это не проект
        основателя.
      </p>
      <p>{label ?? "Сессия активна"}</p>
      <button type="button" onClick={() => void handleSignOut()}>
        Выйти
      </button>

      <section>
        <h2>Вопросы</h2>
        {seedError ? (
          <p className="error">{seedError}</p>
        ) : questions === undefined ? (
          <p>Загрузка каталога…</p>
        ) : questions.length === 0 ? (
          <p>Каталог пуст — выполняется seed.</p>
        ) : (
          <ol>
            {questions.map((question) => (
              <li key={question._id}>
                <code>{question.questionId}</code>
                <span> — {question.title}</span>
                {question.required ? "" : " (необязательный)"}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2>Probe-job</h2>
        {job === undefined && jobId ? (
          <p>Загрузка статуса…</p>
        ) : job ? (
          <p>
            Статус: <strong>{job.status}</strong>
            {job.error ? ` — ${job.error}` : ""}
            {project?.currentRevisionId
              ? ` · ревизия ${project.currentRevisionId}`
              : ""}
          </p>
        ) : (
          <p>Probe ещё не запускался.</p>
        )}
        {actionError ? <p className="error">{actionError}</p> : null}
        <button type="button" onClick={() => void retryProbe()} disabled={pending}>
          Повторить
        </button>
      </section>
    </main>
  );
}
