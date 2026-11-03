import type { AccountRow, Directory } from "../persistence/store";
import { hashToken } from "./crypto";

/** The sign-in cookie: HttpOnly so page scripts can't read it, Lax so other sites can't post or connect with it. */
export const SESSION_COOKIE = "cg_session";
const YEAR = 365 * 24 * 3600;

export function readCookie(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${YEAR}${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(secure: boolean) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** Who's signed in on a request, by its cookie header. */
export async function signedIn(directory: Directory, cookieHeader: string | null | undefined): Promise<{ account: AccountRow; tokenHash: string } | null> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const tokenHash = await hashToken(token);
  const account = await directory.accountBySession(tokenHash);
  return account ? { account, tokenHash } : null;
}

/**
 * Browsers send cookies on WebSocket connections opened by any page, so a socket is only accepted from our own
 * pages: an Origin with the same host (the Vite dev server forwards the host it was asked for).
 */
export function sameOrigin(origin: string | null | undefined, host: string | null | undefined) {
  if (!origin) return true; // not a browser (tests, scripts): there's no page that could have been tricked
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
