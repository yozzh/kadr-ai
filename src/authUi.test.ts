import { expect, test } from "vitest";
import {
  AUTH_RETURN_PARAM,
  identityLabel,
  returnedOAuthError,
  SAFE_SIGN_IN_ERROR,
} from "./authUi";
import appSource from "./App.tsx?raw";
import mainSource from "./main.tsx?raw";

test("guest sees login and not chat, project, or deck", () => {
  expect(appSource).toContain("Войти через Google");
  expect(appSource).toContain('isAuthenticated ? {} : "skip"');
  expect(appSource.toLowerCase()).not.toContain("колода");
  expect(appSource).not.toContain("intent://");
  expect(appSource).not.toMatch(/чат сообщений|ваш проект/i);
});

test("oauth failure stays closed with a safe retry message", () => {
  expect(returnedOAuthError("?error=access_denied")).toBe(SAFE_SIGN_IN_ERROR);
  expect(
    returnedOAuthError("?error=server&error_description=AUTH_GOOGLE_SECRET"),
  ).toBe(SAFE_SIGN_IN_ERROR);
  expect(returnedOAuthError(`?${AUTH_RETURN_PARAM}=1`)).toBe(SAFE_SIGN_IN_ERROR);
  expect(returnedOAuthError(`?${AUTH_RETURN_PARAM}=1&code=ok`)).toBeNull();
  expect(returnedOAuthError(`?${AUTH_RETURN_PARAM}=1`, true)).toBeNull();
  expect(returnedOAuthError("")).toBeNull();
  expect(SAFE_SIGN_IN_ERROR).not.toContain("AUTH_GOOGLE_SECRET");
  expect(appSource).toContain("SAFE_SIGN_IN_ERROR");
  expect(appSource).toContain("Войти через Google");
});

test("signed-in identity prefers name then email; session survives reload via provider", () => {
  expect(identityLabel({ name: "Анна", email: "a@example.com" })).toBe("Анна");
  expect(identityLabel({ name: "  ", email: "a@example.com" })).toBe(
    "a@example.com",
  );
  expect(identityLabel({ email: "a@example.com" })).toBe("a@example.com");
  expect(identityLabel(null)).toBeNull();
  expect(mainSource).toContain("ConvexAuthProvider");
  expect(appSource).toContain("identityLabel");
  expect(appSource).toContain("signOut");
  expect(appSource).toContain("Выйти");
});
