import { expect, test } from "vitest";
import { chooseConvexScreen, readConvexUrl } from "./convexUrl";
import appSource from "./App.tsx?raw";
import mainSource from "./main.tsx?raw";

test("empty Convex URL is an error, not a fake project", () => {
  expect(readConvexUrl(undefined)).toBeNull();
  expect(readConvexUrl("")).toBeNull();
  expect(readConvexUrl("   ")).toBeNull();
  expect(readConvexUrl("example.convex.cloud")).toBeNull();
  expect(readConvexUrl("https://example.convex.cloud")).toBe(
    "https://example.convex.cloud",
  );
});

test("boot screen is error unless the URL has a scheme", () => {
  expect(chooseConvexScreen(undefined)).toEqual({ screen: "error" });
  expect(chooseConvexScreen("")).toEqual({ screen: "error" });
  expect(chooseConvexScreen("   ")).toEqual({ screen: "error" });
  expect(chooseConvexScreen("example.convex.cloud")).toEqual({
    screen: "error",
  });
  expect(chooseConvexScreen("https://example.convex.cloud")).toEqual({
    screen: "provider",
    url: "https://example.convex.cloud",
  });
});

test("client is not the localStorage prototype and does not claim a founder project", () => {
  const sources = `${appSource}\n${mainSource}`;
  expect(sources).not.toContain("localStorage");
  expect(sources.toLowerCase()).not.toContain("ваш проект");
  expect(mainSource).toContain("Нет Convex URL");
  expect(mainSource).toContain("ConvexAuthProvider");
  expect(appSource).toContain("Повторить");
  expect(appSource).toContain("job.error");
  expect(appSource).not.toContain("AUTH_GOOGLE_SECRET");
});
