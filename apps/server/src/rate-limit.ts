/**
 * Token buckets keyed by a string (an IP, a member). Each key holds up to `burst` tokens and regains `perSecond`.
 * In memory: fine for one server process; it resets on restart, which is acceptable for abuse slowing.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private burst: number,
    private perSecond: number,
  ) {}

  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.perSecond);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.sweep(now);
    return ok;
  }

  /** Forget keys that have fully refilled. */
  private sweep(now: number) {
    for (const [k, b] of this.buckets) if (b.tokens + ((now - b.at) / 1000) * this.perSecond >= this.burst) this.buckets.delete(k);
  }
}
