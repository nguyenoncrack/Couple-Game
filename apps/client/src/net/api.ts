import type { Appearance, DeviceClaim, HouseSummary, Me } from "@cg/shared";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Call the JSON API. The sign-in cookie goes along by itself (same site). */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("offline", 0, "Can't reach the game server. Check your connection.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(data.error ?? "server", res.status, data.message ?? "Something went wrong.");
  return data as T;
}

export const getMe = () => call<Me>("GET", "/api/me");
export const signUp = (name: string, password: string, claims: DeviceClaim[]) => call<Me>("POST", "/api/account", { name, password, claims });
export const signIn = (name: string, password: string, claims: DeviceClaim[]) => call<Me>("POST", "/api/session", { name, password, claims });
export const signOut = () => call<{ ok: true }>("DELETE", "/api/session");
export const changePassword = (current: string, next: string) => call<{ ok: true }>("POST", "/api/account/password", { current, next });
export const claimHouses = (claims: DeviceClaim[]) => call<Me>("POST", "/api/claims", { claims });
export const createHouse = (houseName: string, starter = false) => call<HouseSummary>("POST", "/api/houses", { houseName, starter });
export const joinHouse = (code: string) => call<HouseSummary>("POST", "/api/join", { code });
export const leaveHouse = (houseId: string) => call<{ ok: true }>("DELETE", `/api/houses/${houseId}`);

export const saveAppearance = (appearance: Appearance) => call<{ appearance: Appearance }>("PUT", "/api/account/appearance", appearance);

export const getAppearance = () => call<{ appearance: Appearance | null }>("GET", "/api/account/appearance");
