const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A random ID (base62). Clients make their own object IDs, so placing something doesn't wait on the server. */
export function newId(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  // 248 is the largest multiple of 62 under 256; rejecting above it keeps every character equally likely.
  for (let i = 0; out.length < length; i++) {
    if (i >= bytes.length) {
      crypto.getRandomValues(bytes);
      i = 0;
    }
    const b = bytes[i]!;
    if (b < 248) out += ALPHABET[b % 62];
  }
  return out;
}
