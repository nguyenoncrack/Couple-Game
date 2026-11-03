/**
 * Secrets, hashes and codes, with the Web Crypto API only, so the same code runs on Node and on Cloudflare.
 */

const subtle = () => crypto.subtle;
const bytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function base64url(b: Uint8Array) {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** A session secret for a cookie. Only its hash is stored, so a leaked database can't be used to sign in. */
export const newToken = () => base64url(bytes(32));

export async function hashToken(token: string) {
  const d = new Uint8Array(await subtle().digest("SHA-256", new TextEncoder().encode(token)));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Cloudflare Workers allow at most 100k PBKDF2 rounds. That's the default; the Worker uses fewer to stay inside the
 * free plan's CPU time per request. Each hash records its own rounds, so changing this never locks anyone out.
 */
export const ROUNDS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number) {
  const key = await subtle().importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256));
}

/** A salted, slow hash of a password, stored as "pbkdf2-sha256$rounds$salt$hash". */
export async function hashPassword(password: string, rounds = ROUNDS) {
  const salt = bytes(16);
  return `pbkdf2-sha256$${rounds}$${base64url(salt)}$${base64url(await pbkdf2(password, salt, rounds))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [kind, rounds, salt, hash] = stored.split("$");
  if (kind !== "pbkdf2-sha256" || !rounds || !salt || !hash || !(Number(rounds) > 0 && Number(rounds) <= ROUNDS)) return false;
  const got = await pbkdf2(password, fromBase64url(salt), Number(rounds));
  const want = fromBase64url(hash);
  // compare every byte, so the time taken says nothing about how close a guess was
  let diff = got.length ^ want.length;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ (want[i] ?? 0);
  return diff === 0;
}

/** Checked against when there's no such account, so a missing name takes as long as a wrong password. */
export const DUMMY_HASH = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** No 0/O, 1/I/L or 5/S, so a code read out loud or off a phone comes through right. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";

function randomIndex(n: number) {
  // reject values past the last whole multiple of n, so every index is equally likely
  const limit = 256 - (256 % n);
  for (;;) {
    const b = bytes(1)[0]!;
    if (b < limit) return b % n;
  }
}

/** A private room code like "KX4-29P" (29^6 ≈ 600 million combinations; guessing is rate-limited). */
export function newInviteCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomIndex(CODE_ALPHABET.length)];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

/** Accepts codes typed loosely ("kx429p", "KX4 29P") and returns the canonical form, or null. */
export function normalizeInviteCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 6 || [...raw].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}
