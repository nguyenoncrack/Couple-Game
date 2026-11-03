import type { DeviceClaim } from "@cg/shared";

/**
 * Before accounts, each browser kept its houses here with a secret token for each. Those tokens go along once when
 * you sign in or sign up, so the houses move to your account, and are then forgotten. If storage is blocked
 * (private mode), there's simply nothing to move.
 */

const KEY = "cg.houses.v1";

export function deviceClaims(): DeviceClaim[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return Object.values(JSON.parse(raw) as Record<string, { houseId: string; token: string }>)
      .filter((h) => typeof h.houseId === "string" && typeof h.token === "string")
      .map((h) => ({ houseId: h.houseId, token: h.token }));
  } catch {
    return [];
  }
}

export function forgetDeviceClaims() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}

/** The name you last signed in with, to prefill the form. */
export function lastPlayerName(): string {
  try {
    return localStorage.getItem("cg.name") ?? "";
  } catch {
    return "";
  }
}

export function rememberPlayerName(name: string) {
  try {
    localStorage.setItem("cg.name", name);
  } catch {
    // fine
  }
}
