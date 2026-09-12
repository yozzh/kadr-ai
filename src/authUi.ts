export const AUTH_RETURN_PARAM = "auth";
export const SAFE_SIGN_IN_ERROR = "Couldn't sign in. Try again.";
export const APP_VERSION = "0.0.0";
export const PROBE_PARAM = "probe";

export function isEmbeddedWebView(ua: string): boolean {
  return (
    ua.includes("Instagram") ||
    ua.includes("FBAN") ||
    ua.includes("Line/") ||
    ua.includes("; wv)")
  );
}

export function probeRequested(search: string): boolean {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return params.get(PROBE_PARAM) === "1";
}

export function currentOriginUrl(loc: {
  origin: string;
  pathname: string;
  search: string;
  hash: string;
}): string {
  return `${loc.origin}${loc.pathname}${loc.search}${loc.hash}`;
}

export async function openSameOriginOutsideWebView(opts: {
  url: string;
  openWindow: (url: string) => unknown;
  copyText: (text: string) => Promise<void>;
}): Promise<"opened" | "copied"> {
  let opened: unknown;
  try {
    opened = opts.openWindow(opts.url);
  } catch {
    opened = null;
  }
  let usable = false;
  try {
    usable = Boolean(opened) && (opened as { closed?: boolean }).closed !== true;
  } catch {
    usable = false;
  }
  if (usable) {
    return "opened";
  }
  await opts.copyText(opts.url);
  return "copied";
}

export function returnedOAuthError(
  search: string,
  isAuthenticated = false,
): string | null {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  if (params.has("error") || params.has("error_description")) {
    return SAFE_SIGN_IN_ERROR;
  }
  if (params.has(AUTH_RETURN_PARAM) && !params.has("code") && !isAuthenticated) {
    return SAFE_SIGN_IN_ERROR;
  }
  return null;
}

export function identityLabel(
  user:
    | {
        name?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
): string | null {
  const name = user?.name?.trim();
  if (name) {
    return name;
  }
  const email = user?.email?.trim();
  if (email) {
    return email;
  }
  return null;
}
