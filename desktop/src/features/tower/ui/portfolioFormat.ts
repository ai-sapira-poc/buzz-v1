const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Relative recency, or `null` when the line has no readable span.
 *
 * `null` is not "idle" and not "just now": the UI renders its own "silence ≠
 * inactivity" copy for it, so the caller must be able to tell an unreadable
 * timestamp apart from a readable one.
 */
export function formatRecency(
  lastSpanAt: string | null,
  now: number = Date.now(),
): string | null {
  if (lastSpanAt === null) return null;
  const parsed = Date.parse(lastSpanAt);
  if (Number.isNaN(parsed)) return null;
  const delta = now - parsed;
  if (delta < MINUTE_MS) return "just now";
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)} min ago`;
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)} h ago`;
  return `${Math.floor(delta / DAY_MS)} d ago`;
}

/** Thousands-separated token count for the cost cell. */
export function formatTokens(count: number): string {
  return count.toLocaleString("en-US");
}
