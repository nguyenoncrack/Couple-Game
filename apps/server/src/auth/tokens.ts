import { createHash, randomBytes, randomInt } from "node:crypto";

/** A member's secret. Only its hash is stored, so a leaked database can't be used to sign in. */
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** No 0/O, 1/I/L or 5/S, so a code read out loud or off a phone comes through right. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";

/** A private room code like "KX4-29P" (29^6 ≈ 600 million combinations; guessing is rate-limited). */
export function newInviteCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

/** Accepts codes typed loosely ("kx429p", "KX4 29P") and returns the canonical form, or null. */
export function normalizeInviteCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 6 || [...raw].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}
