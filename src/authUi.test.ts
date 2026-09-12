import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
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
import appSource from "./App.tsx?raw";
import mainSource from "./main.tsx?raw";
import indexHtml from "../index.html?raw";

const indexCss = readFileSync(new URL("./index.css", import.meta.url), "utf8");

test("guest sees Sign in with Google and not chat, project, or deck", () => {
  expect(appSource).toContain("Sign in with Google");
  expect(appSource).toContain('signIn("google"');
  expect(appSource).toContain("Kadr");
  expect(appSource).toContain('isAuthenticated ? {} : "skip"');
  expect(appSource).not.toContain("Войти через Google");
  expect(appSource.toLowerCase()).not.toContain("колода");
  expect(appSource).not.toContain("intent://");
  expect(appSource).not.toMatch(/чат сообщений|ваш проект/i);
});

test("embedded webview shows Open in browser and never starts Google", () => {
  expect(isEmbeddedWebView("Mozilla/5.0 Instagram 192.168.1.2.80")).toBe(true);
  expect(isEmbeddedWebView("Mozilla/5.0 FBAN/FBIOS")).toBe(true);
  expect(isEmbeddedWebView("Mozilla/5.0 Line/13.0.0")).toBe(true);
  expect(
    isEmbeddedWebView(
      "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36",
    ),
  ).toBe(true);
  expect(
    isEmbeddedWebView(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0",
    ),
  ).toBe(false);
  expect(appSource).toContain(
    "const embedded = isEmbeddedWebView(navigator.userAgent)",
  );
  expect(appSource).toContain("Open in browser");
  expect(appSource).toContain("disabled={embedded}");
  expect(appSource).toMatch(
    /if \(isEmbeddedWebView\(navigator\.userAgent\)\) \{\s*return;/,
  );
  expect(appSource).not.toContain("intent://");
  expect(appSource).not.toContain("Error 403");
});

test("open in browser stays on the same origin and never uses intent://", async () => {
  const url = currentOriginUrl({
    origin: "https://kadr.example",
    pathname: "/",
    search: "",
    hash: "",
  });
  expect(url).toBe("https://kadr.example/");
  expect(url).not.toContain("intent://");
  expect(appSource).not.toContain("intent://");
  expect(appSource).toContain("setAuthError(url)");

  await expect(
    openSameOriginOutsideWebView({
      url,
      openWindow: () => ({ closed: false }),
      copyText: async () => {
        throw new Error("should not copy when a window opens");
      },
    }),
  ).resolves.toBe("opened");

  let copied = "";
  await expect(
    openSameOriginOutsideWebView({
      url,
      openWindow: () => null,
      copyText: async (text) => {
        copied = text;
      },
    }),
  ).resolves.toBe("copied");
  expect(copied).toBe(url);

  copied = "";
  await expect(
    openSameOriginOutsideWebView({
      url,
      openWindow: () => {
        throw new Error("blocked");
      },
      copyText: async (text) => {
        copied = text;
      },
    }),
  ).resolves.toBe("copied");
  expect(copied).toBe(url);

  copied = "";
  await expect(
    openSameOriginOutsideWebView({
      url,
      openWindow: () => ({ closed: true }),
      copyText: async (text) => {
        copied = text;
      },
    }),
  ).resolves.toBe("copied");
  expect(copied).toBe(url);
});

test("oauth failure stays closed with a safe English retry message", () => {
  expect(returnedOAuthError("?error=access_denied")).toBe(SAFE_SIGN_IN_ERROR);
  expect(
    returnedOAuthError("?error=server&error_description=AUTH_GOOGLE_SECRET"),
  ).toBe(SAFE_SIGN_IN_ERROR);
  expect(returnedOAuthError(`?${AUTH_RETURN_PARAM}=1`)).toBe(SAFE_SIGN_IN_ERROR);
  expect(returnedOAuthError(`?${AUTH_RETURN_PARAM}=1&code=ok`)).toBeNull();
  expect(returnedOAuthError(`?${AUTH_RETURN_PARAM}=1`, true)).toBeNull();
  expect(returnedOAuthError("")).toBeNull();
  expect(SAFE_SIGN_IN_ERROR).toMatch(/sign in/i);
  expect(SAFE_SIGN_IN_ERROR).not.toMatch(/[А-яЁё]/);
  expect(SAFE_SIGN_IN_ERROR).not.toContain("AUTH_GOOGLE_SECRET");
  expect(appSource).toContain("SAFE_SIGN_IN_ERROR");
  expect(appSource).toContain("Sign in with Google");
});

test("signed-in Settings shows name or email, version, and Log out", () => {
  expect(identityLabel({ name: "Анна", email: "a@example.com" })).toBe("Анна");
  expect(identityLabel({ name: "  ", email: "a@example.com" })).toBe(
    "a@example.com",
  );
  expect(identityLabel({ email: "a@example.com" })).toBe("a@example.com");
  expect(identityLabel(null)).toBeNull();
  expect(mainSource).toContain("ConvexAuthProvider");
  expect(appSource).toContain("identityLabel");
  expect(appSource).toContain("signOut");
  expect(appSource).toContain("Log out");
  expect(appSource).not.toContain("Выйти");
  expect(appSource).toContain("Chat");
  expect(appSource).toContain("Project");
  expect(appSource).toContain("Settings");
  expect(appSource).toContain("APP_VERSION");
  expect(APP_VERSION).toBe("0.0.0");
  expect(appSource).not.toContain("1.0.0 (42)");
});

test("probe is off the default signed-in Settings tree", () => {
  expect(probeRequested("")).toBe(false);
  expect(probeRequested("?foo=1")).toBe(false);
  expect(probeRequested("?probe=1")).toBe(true);
  expect(appSource).toMatch(
    /const showProbe =\s*isAuthenticated && probeRequested\(window\.location\.search\)/,
  );
  expect(appSource).toMatch(/questions\.list[\s\S]*showProbe \? \{\} : "skip"/);
  expect(appSource).toMatch(/if \(showProbe\) \{/);
  expect(appSource).toContain("Контракт Convex");
  const guestStart = appSource.indexOf("if (!isAuthenticated)");
  const probeStart = appSource.indexOf("if (showProbe)");
  expect(guestStart).toBeGreaterThan(-1);
  expect(probeStart).toBeGreaterThan(guestStart);
  const guestBranch = appSource.slice(guestStart, probeStart);
  expect(guestBranch).not.toContain("tabbar");
  expect(guestBranch).not.toContain("Chat");
  expect(guestBranch).not.toContain("Project");
});

test("index.html and index.css ship English Kadr chrome fonts", () => {
  expect(indexHtml).toContain('lang="en"');
  expect(indexHtml).toContain("<title>Kadr</title>");
  expect(indexHtml).toContain("Inter");
  expect(indexHtml).toContain("Manrope");
  expect(indexCss).toMatch(/--font-body:\s*Inter/);
  expect(indexCss).toMatch(/--font-display:\s*Manrope/);
  expect(indexCss).not.toMatch(/Palatino|Iowan/);
});

test("log out returns to guest chrome and hides probe identity", () => {
  expect(appSource).toMatch(
    /async function handleSignOut\(\) \{\s*await signOut\(\);/,
  );
  expect(appSource).toMatch(
    /if \(isAuthenticated\) \{\s*return;\s*\}\s*setProjectId\(null\);\s*setJobId\(null\);/,
  );
  expect(appSource).toMatch(
    /if \(!isAuthenticated\) \{[\s\S]*Sign in with Google[\s\S]*if \(showProbe\)/,
  );
});

test("rejected chat send keeps the draft, slide context, and retry id without confirming", async () => {
  let sendArgs: { body: string; clientMessageId: string; slideId?: string } | undefined;
  const result = await sendChatDraft({
    projectId: "project-id" as never,
    draft: "Still here",
    clientMessageId: null,
    makeId: () => "retry-id",
    slideId: "slide-id",
    send: async (args) => {
      sendArgs = args;
      throw new Error("network unavailable");
    },
  });

  expect(sendArgs).toMatchObject({
    body: "Still here",
    clientMessageId: "retry-id",
    slideId: "slide-id",
  });
  expect(result).toEqual({
    draft: "Still here",
    clientMessageId: "retry-id",
    error: "Couldn't send your message. Check your connection and try again.",
    confirmed: false,
  });
});

test("chat exposes compact onboarding consent and progress actions", () => {
  expect(appSource).toContain("Presentation onboarding offer");
  expect(appSource).toContain("Six quick questions · about 3 minutes");
  expect(appSource).toContain("Presentation brief progress");
  expect(appSource).not.toContain("Confirm brief");
  expect(appSource).toContain("api.supervisorState.acceptSkillOffer");
  expect(appSource).toContain("api.brief.progress");
});

test("chat exposes brief-ready plan generation, progress, and explicit safe retry", () => {
  expect(appSource).toContain("api.plan.generate");
  expect(appSource).toContain("api.plan.current");
  expect(appSource).toContain("api.plan.retry");
  expect(appSource).toContain("Your brief is ready");
  expect(appSource).toContain("Generate plan");
  expect(appSource).toContain("Building…");
  expect(appSource).toContain("Couldn't build the presentation plan.");
  expect(appSource).not.toContain("PLAN_GENERATION_FAILED");
});

test("chat and project expose the reactive vertical viewer and slide context", () => {
  expect(appSource).toContain("api.slides.generate");
  expect(appSource).toContain("api.slides.current");
  expect(appSource).toContain("api.slides.retry");
  expect(appSource).toContain("Your plan is ready");
  expect(appSource).toContain("Generate slides");
  expect(appSource).toContain("Presentation slides");
  expect(appSource).toContain("Couldn't build the presentation slides.");
  expect(appSource).toContain('slides?.job?.status === "succeeded"');
  expect(appSource).toContain('message.role === "assistant" && message.body === slidesReadyMessage');
  expect(appSource).toContain("{slidesReadyMessage}");
  expect(appSource).not.toContain("SLIDES_GENERATION_FAILED");
  expect(appSource).toContain("Presentation");
  expect(appSource).toContain("Previous slide");
  expect(appSource).toContain("Next slide");
  expect(appSource).toContain('event.key === "ArrowUp"');
  expect(appSource).toContain('event.key === "ArrowDown"');
  expect(appSource).toContain("onTouchStart");
  expect(appSource).toContain("Clear slide context");
  expect(appSource).toContain("Building slides…");
  expect(appSource).toContain("<IconChat />");
  expect(indexCss).toMatch(/\.slide-card\s*\{[\s\S]*aspect-ratio:\s*9 \/ 16;/);
  expect(indexCss).toMatch(/\.slide-card__copy\s*\{[\s\S]*overflow-y:\s*auto;/);
});

test("chat UI keeps composer, history, markdown, and favicon contracts", () => {
  expect(appSource).toContain("useLayoutEffect");
  expect(appSource).toContain("Math.min(composer.scrollHeight, 112)");
  expect(appSource).toContain("chat.scrollTop = chat.scrollHeight");
  expect(appSource).toContain('event.key === "Enter"');
  expect(appSource).toContain("!event.shiftKey");
  expect(appSource).toContain("!event.nativeEvent.isComposing");
  expect(appSource).toContain("ReactMarkdown");
  expect(appSource).toContain('message.role === "assistant"');
  expect(indexCss).toMatch(/\.app\s*\{[\s\S]*height:\s*100dvh;[\s\S]*overflow:\s*hidden;/);
  expect(indexCss).toMatch(/\.chat\s*\{[\s\S]*overflow-y:\s*auto;/);
  expect(indexCss).toMatch(/\.message-list\s*\{[\s\S]*margin-top:\s*auto;/);
  expect(indexHtml).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
});
