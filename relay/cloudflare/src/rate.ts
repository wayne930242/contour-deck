/** Per-socket rate limit of docs/PROTOCOL.md: 60 messages/s, burst 120, close after 10 s of sustained excess. */

export const RATE = {
  perSecond: 60,
  burst: 120,
  excessMs: 10_000,
} as const;

/** Token bucket state; plain data so it survives hibernation in the socket attachment. */
export interface Bucket {
  tokens: number;
  /** When `tokens` was last brought up to date (ms). */
  at: number;
  /** When the current run of drops began (ms); null while the socket is within its rate. */
  excessSince: number | null;
}

export type Verdict = "pass" | "drop" | "close";

export function newBucket(now: number): Bucket {
  return { tokens: RATE.burst, at: now, excessSince: null };
}

/**
 * Accounts for one message at `now` and says what to do with it.
 * A run of drops ends when the bucket has refilled completely, i.e. the sender paused for the whole burst.
 */
export function take(bucket: Bucket, now: number): Verdict {
  const elapsed = Math.max(0, now - bucket.at);
  bucket.at = Math.max(bucket.at, now);
  bucket.tokens = Math.min(RATE.burst, bucket.tokens + (elapsed * RATE.perSecond) / 1000);
  if (bucket.tokens >= RATE.burst) bucket.excessSince = null;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return "pass";
  }
  // Measured on `bucket.at`, which never steps back with the clock.
  bucket.excessSince ??= bucket.at;
  return bucket.at - bucket.excessSince >= RATE.excessMs ? "close" : "drop";
}
