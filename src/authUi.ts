export const AUTH_RETURN_PARAM = "auth";
export const SAFE_SIGN_IN_ERROR = "Не удалось войти. Попробуйте ещё раз.";

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
