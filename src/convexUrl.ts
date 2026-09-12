export function readConvexUrl(raw: string | undefined): string | null {
  const url = raw?.trim() ?? "";
  return url.includes("://") ? url : null;
}

export function chooseConvexScreen(
  raw: string | undefined,
): { screen: "error" } | { screen: "provider"; url: string } {
  const url = readConvexUrl(raw);
  return url === null ? { screen: "error" } : { screen: "provider", url };
}
