import {
  Component,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import type { Doc } from "../convex/_generated/dataModel";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  APP_VERSION,
  AUTH_RETURN_PARAM,
  currentOriginUrl,
  identityLabel,
  isEmbeddedWebView,
  openSameOriginOutsideWebView,
  probeRequested,
  returnedOAuthError,
  SAFE_SIGN_IN_ERROR,
  sendChatDraft,
} from "./authUi";

export default function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const showProbe =
    isAuthenticated && probeRequested(window.location.search);
  const questions = useQuery(
    api.questions.list,
    showProbe ? {} : "skip",
  );
  const seed = useMutation(api.questions.seed);
  const startProbe = useMutation(api.jobs.startProbe);
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null);
  const [jobId, setJobId] = useState<Id<"jobs"> | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const embedded = isEmbeddedWebView(navigator.userAgent);

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
    if (!showProbe) {
      return;
    }
    void seed({}).catch((error) => {
      setSeedError(
        error instanceof Error ? error.message : "Не удалось выполнить seed",
      );
    });
  }, [showProbe, seed]);

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
    if (isEmbeddedWebView(navigator.userAgent)) {
      return;
    }
    setAuthError(null);
    try {
      await signIn("google", { redirectTo: `?${AUTH_RETURN_PARAM}=1` });
    } catch {
      setAuthError(SAFE_SIGN_IN_ERROR);
    }
  }

  async function handleOpenInBrowser() {
    const url = currentOriginUrl(window.location);
    try {
      await openSameOriginOutsideWebView({
        url,
        openWindow: (href) => window.open(href, "_blank", "noopener,noreferrer"),
        copyText: (text) => navigator.clipboard.writeText(text),
      });
    } catch {
      setAuthError(url);
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
        <p>Loading…</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app">
        {embedded ? (
          <button
            type="button"
            className="webview-banner"
            onClick={() => void handleOpenInBrowser()}
          >
            <IconExternal className="webview-banner__icon" />
            <span className="webview-banner__copy">
              <span className="webview-banner__title">Open in browser</span>
              <span className="webview-banner__hint">
                Google sign-in is not available inside this app
              </span>
            </span>
            <IconChevron className="webview-banner__chevron" />
          </button>
        ) : null}
        <main className={embedded ? "auth auth--webview" : "auth"}>
          <div>
            <div className="brand">
              <span className="brand__mark">K</span>
              <span className="brand__name">Kadr</span>
            </div>
            <div className="auth__copy">
              <p className="eyebrow">
                {embedded ? "Secure sign-in" : "A pitch from a conversation"}
              </p>
              <h1 className="auth__title">
                {embedded
                  ? "Continue in your browser"
                  : "Build your pitch by talking to Kadr"}
              </h1>
              <p className="auth__lede">
                {embedded
                  ? "Return to Kadr after you sign in — your project will open automatically."
                  : "Kadr asks questions, assembles a vertical deck, and prepares the video — no templates, no timeline."}
              </p>
              {authError ? <p className="error">{authError}</p> : null}
            </div>
          </div>
          <div className="auth__actions">
            <button
              type="button"
              className="google-btn"
              disabled={embedded}
              onClick={() => void handleSignIn()}
            >
              <span className="google-btn__g">G</span>
              Sign in with Google
            </button>
            <p className="auth__note">
              {embedded
                ? "This button does not start inside an embedded WebView."
                : "By continuing, you agree to the terms of use."}
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (showProbe) {
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
          Log out
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

  return (
    <ProductShell me={me} onSignOut={() => void handleSignOut()} />
  );
}

type AppTab = "chat" | "project" | "settings";

class ProjectLoadBoundary extends Component<
  {
    children: ReactNode;
    tab: AppTab;
    onTab: (tab: AppTab) => void;
    onRetry: () => void;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  remount() {
    this.setState({ failed: false });
    this.props.onRetry();
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="app">
          <header className="project-header">
            <div className="project-header__copy">
              <h1>Project</h1>
              <p className="project-header__scope">One current project</p>
            </div>
          </header>
          <main className="project-status">
            <p className="error">Couldn't load project.</p>
            <button
              type="button"
              className="retry-btn"
              onClick={() => this.remount()}
            >
              Retry
            </button>
          </main>
          <TabBar
            tab={this.props.tab}
            onTab={(tab) => {
              this.props.onTab(tab);
              this.remount();
            }}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

function ProductShell({
  me,
  onSignOut,
}: {
  me: Parameters<typeof identityLabel>[0];
  onSignOut: () => void;
}) {
  const [shellKey, setShellKey] = useState(0);
  const [tab, setTab] = useState<AppTab>("chat");

  return (
    <ProjectLoadBoundary
      tab={tab}
      onTab={setTab}
      onRetry={() => setShellKey((key) => key + 1)}
    >
      <ProductShellBody
        key={shellKey}
        tab={tab}
        onTab={setTab}
        me={me}
        onSignOut={onSignOut}
      />
    </ProjectLoadBoundary>
  );
}

function ProductShellBody({
  me,
  onSignOut,
  tab,
  onTab,
}: {
  me: Parameters<typeof identityLabel>[0];
  onSignOut: () => void;
  tab: AppTab;
  onTab: (tab: AppTab) => void;
}) {
  const [ensureError, setEnsureError] = useState<string | null>(null);
  const current = useQuery(api.projects.current);
  const ensure = useMutation(api.projects.ensure);

  useEffect(() => {
    let cancelled = false;
    void ensure({})
      .then(() => {
        if (!cancelled) {
          setEnsureError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnsureError("Couldn't load project.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ensure]);

  function retryProject() {
    setEnsureError(null);
    void ensure({}).catch(() => {
      setEnsureError("Couldn't load project.");
    });
  }

  return (
    <div className="app">
      {tab === "chat" ? <ChatPane current={current} /> : null}
      {tab === "project" ? (
        <ProjectPane
          current={current}
          ensureError={ensureError}
          onGoToChat={() => onTab("chat")}
          onRetry={retryProject}
        />
      ) : null}
      {tab === "settings" ? <SettingsPane me={me} onSignOut={onSignOut} /> : null}
      <TabBar tab={tab} onTab={onTab} />
    </div>
  );
}

function ChatPane({
  current,
}: {
  current: Doc<"projects"> | null | undefined;
}) {
  const [draft, setDraft] = useState("");
  const [clientMessageId, setClientMessageId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messages = useQuery(
    api.messages.list,
    current ? { projectId: current._id } : "skip",
  );
  const send = useMutation(api.messages.send);
  const latestJob = useQuery(
    api.jobs.latestSupervisor,
    current ? { projectId: current._id } : "skip",
  );
  const retrySupervisor = useMutation(api.jobs.retrySupervisor);
  const [retrying, setRetrying] = useState(false);
  const brief = useQuery(
    api.brief.progress,
    current ? { projectId: current._id } : "skip",
  );
  const acceptOnboarding = useMutation(api.supervisorState.acceptSkillOffer);
  const stopOnboarding = useMutation(api.supervisorState.clearSkillForUser);
  const confirmBrief = useMutation(api.brief.confirmBrief);
  const [briefActionPending, setBriefActionPending] = useState(false);

  async function runBriefAction(action: () => Promise<unknown>) {
    setBriefActionPending(true);
    setSendError(null);
    try {
      await action();
    } catch {
      setSendError("Couldn't update onboarding. Please try again.");
    } finally {
      setBriefActionPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || sending) {
      return;
    }
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setSendError("Write a message before sending.");
      return;
    }
    if (trimmed.length > 4000) {
      setSendError("Your message is too long (maximum 4,000 characters).");
      return;
    }

    setSending(true);
    setSendError(null);
    const result = await sendChatDraft({
      projectId: current._id,
      draft,
      clientMessageId,
      makeId: () => crypto.randomUUID(),
      send,
    });
    setDraft(result.draft);
    setClientMessageId(result.clientMessageId);
    setSendError(result.error);
    setSending(false);
  }

  return (
    <>
      <header className="chat-header">
        <div className="brand">
          <span className="brand__mark">K</span>
          <span className="brand__name">Kadr</span>
        </div>
      </header>
      <main className="chat" aria-live="polite">
        <p className="chat__day">Today</p>
        {current == null || messages === undefined ? (
          <p className="chat__status">Loading conversation…</p>
        ) : messages.length === 0 ? (
          <div className="message message--assistant">
            Your interview will appear here when Kadr is connected.
          </div>
        ) : (
          <div className="message-list">
            {messages.map((message) => (
              <div
                className={`message message--${message.role}`}
                key={message._id}
              >
                {message.body}
              </div>
            ))}
            {latestJob?.status === "queued" || latestJob?.status === "running" ? (
              <p className="supervisor-status">Kadr is thinking…</p>
            ) : null}
            {latestJob?.status === "failed" ? (
              <div className="supervisor-failed" role="alert">
                <span>Couldn't get a reply.</span>
                <button
                  type="button"
                  disabled={retrying}
                  onClick={() => {
                    setRetrying(true);
                    void retrySupervisor({ jobId: latestJob._id }).finally(() => setRetrying(false));
                  }}
                >
                  Retry
                </button>
              </div>
            ) : null}
          </div>
        )}
      </main>
      {current && brief?.state.pendingIntent ? (
        <section className="onboarding-card" aria-label="Presentation onboarding offer">
          <div>
            <strong>Build your presentation brief</strong>
            <span>Six quick questions · about 3 minutes</span>
          </div>
          <div className="onboarding-card__actions">
            <button type="button" className="onboarding-secondary" disabled={briefActionPending} onClick={() => void runBriefAction(() => stopOnboarding({ projectId: current._id }))}>Not now</button>
            <button type="button" className="onboarding-primary" disabled={briefActionPending} onClick={() => void runBriefAction(() => acceptOnboarding({ projectId: current._id }))}>Start</button>
          </div>
        </section>
      ) : null}
      {current && brief?.state.activeSkill === "presentation_onboarding" ? (
        <section className="onboarding-progress" aria-label="Presentation brief progress">
          <div className="onboarding-progress__copy">
            <span>Presentation brief</span>
            <strong>{brief.closedCount} of {brief.totalCount}</strong>
          </div>
          <progress value={brief.closedCount} max={brief.totalCount}>{brief.closedCount} of {brief.totalCount}</progress>
          <div className="onboarding-card__actions">
            <button type="button" className="onboarding-secondary" disabled={briefActionPending} onClick={() => void runBriefAction(() => stopOnboarding({ projectId: current._id }))}>Stop</button>
            {brief.complete ? (
              <button type="button" className="onboarding-primary" disabled={briefActionPending} onClick={() => void runBriefAction(() => confirmBrief({ projectId: current._id, revisionId: brief.revisionId }))}>Confirm brief</button>
            ) : null}
          </div>
        </section>
      ) : null}
      <form className="composer" onSubmit={(event) => void handleSubmit(event)}>
        <label className="sr-only" htmlFor="chat-message">
          Message Kadr
        </label>
        <textarea
          id="chat-message"
          value={draft}
          rows={1}
          placeholder="Tell Kadr about your project…"
          disabled={!current}
          onChange={(event) => {
            setDraft(event.target.value);
            setSendError(null);
          }}
        />
        <button
          type="submit"
          className="composer__send"
          aria-label="Send message"
          disabled={!current || sending}
        >
          <IconSend />
        </button>
        {sendError ? (
          <p className="composer__error" role="alert">
            {sendError}
          </p>
        ) : null}
      </form>
    </>
  );
}

function ProjectPane({
  current,
  ensureError,
  onGoToChat,
  onRetry,
}: {
  current: Doc<"projects"> | null | undefined;
  ensureError: string | null;
  onGoToChat: () => void;
  onRetry: () => void;
}) {
  return (
    <>
      <header className="project-header">
        <div className="project-header__copy">
          <h1>Project</h1>
          <p className="project-header__scope">One current project</p>
        </div>
        <span className="project-header__icon" aria-hidden="true">
          <IconProject />
        </span>
      </header>
      {ensureError && current == null ? (
        <main className="project-status">
          <p className="error">{ensureError}</p>
          <button type="button" className="retry-btn" onClick={onRetry}>
            Retry
          </button>
        </main>
      ) : current == null ? (
        <main className="project-status">
          <div className="skeleton-deck" aria-hidden="true" />
          <p>Loading</p>
        </main>
      ) : (
        <main className="project-empty">
          <div className="deck-placeholder">
            <IconProject />
            <p>Your vertical 9:16 deck will appear here</p>
          </div>
          <div className="project-empty__copy">
            <h2>Start by talking about the project</h2>
            <p>
              Kadr asks a few questions and builds the first pitch. No templates
              to pick.
            </p>
          </div>
          <button type="button" className="go-chat-btn" onClick={onGoToChat}>
            <IconChat />
            Go to chat
          </button>
          <p className="project-empty__helper">
            Start onboarding · about 3 minutes
          </p>
        </main>
      )}
    </>
  );
}

function SettingsPane({
  me,
  onSignOut,
}: {
  me: Parameters<typeof identityLabel>[0];
  onSignOut: () => void;
}) {
  const label = identityLabel(me);
  const initial = label ? ([...label][0] ?? "").toUpperCase() : "";

  return (
    <>
      <header className="settings-header">
        <h1>Settings</h1>
      </header>
      <main className="settings">
        <div className="settings__fields">
          <section>
            <p className="field-label">Display name</p>
            <div className="name-field">
              <div className="name-field__who">
                {initial ? (
                  <span className="name-field__initial">{initial}</span>
                ) : null}
                {label ? <span className="name-field__label">{label}</span> : null}
              </div>
              <span className="name-field__pencil" aria-hidden="true">
                <IconPencil />
              </span>
            </div>
          </section>
          <section>
            <p className="field-label">About</p>
            <div className="version-row">
              <span className="version-row__title">App version</span>
              <span className="version-row__value">{APP_VERSION}</span>
            </div>
          </section>
        </div>
        <button type="button" className="logout-btn" onClick={onSignOut}>
          <IconLogout />
          Log out
        </button>
      </main>
    </>
  );
}

function TabBar({
  tab,
  onTab,
}: {
  tab: AppTab;
  onTab: (next: AppTab) => void;
}) {
  return (
    <nav className="tabbar" aria-label="Kadr">
      <button
        type="button"
        className={tab === "chat" ? "tab tab--active" : "tab"}
        aria-current={tab === "chat" ? "page" : undefined}
        onClick={() => onTab("chat")}
      >
        <IconChat />
        Chat
      </button>
      <button
        type="button"
        className={tab === "project" ? "tab tab--active" : "tab"}
        aria-current={tab === "project" ? "page" : undefined}
        onClick={() => onTab("project")}
      >
        <IconProject />
        Project
      </button>
      <button
        type="button"
        className={tab === "settings" ? "tab tab--active" : "tab"}
        aria-current={tab === "settings" ? "page" : undefined}
        onClick={() => onTab("settings")}
      >
        <IconSettings />
        Settings
      </button>
    </nav>
  );
}

function IconExternal(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M15 3h6v6M21 3l-9 9M10 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevron(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="m9 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3M16 17l5-5-5-5M21 12H9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7.9 20A9 9 0 1 0 4 16.1L3 21Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconProject() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M3 9h18M9 21V9" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m5 12 14-7-5 14-2-5-7-2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
