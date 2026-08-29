/**
 * Detection for the dev-server preview sentinel: `[preview] http://localhost:PORT`.
 *
 * Deliberately separate from `shared/lib/linkPreview.ts`. That module is
 * HTTPS-only by design and feeds the sender-authored snapshot pipeline whose
 * privacy contract is that recipients never contact external sites. Widening
 * its regex to admit `http://` would relax that boundary for every message in
 * the app. This detector stays narrow instead: loopback hosts only, one
 * sentinel form, and no network contact of its own.
 *
 * The sentinel is a message convention, so any author can emit it. Callers must
 * gate on the message being signed by a known agent before rendering anything —
 * see `getDevPreviewAuthorPubkey`. A structured event tag would be the stronger
 * design; `docs/plan-artifact-preview.md` §8 records it as the upgrade path.
 */

/** Loopback hosts only. A hostname that merely *contains* one does not match. */
const SENTINEL_RE =
  /\[preview\]\s+(http:\/\/(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))(?:\/[^\s<>"'`]*)?)/gi;

/** Mirrors MAX_PREVIEWS in linkPreview.ts — one message cannot flood the UI. */
const MAX_DEV_PREVIEWS = 4;

export type DevPreviewTarget = {
  /** Full URL, including any path the sentinel carried. */
  url: string;
  port: number;
};

/**
 * Extract every dev-server sentinel from a message body.
 *
 * Returns an empty array for anything that is not an exact match: a
 * non-loopback host, a missing or out-of-range port, `https`, or the bare URL
 * without the sentinel prefix.
 */
export function parseDevPreviewAnnouncements(
  content: string,
): DevPreviewTarget[] {
  const targets: DevPreviewTarget[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(SENTINEL_RE)) {
    const url = match[1];
    const port = Number.parseInt(match[2] ?? "", 10);
    if (!url || !Number.isFinite(port)) continue;
    // Port 0 is not addressable and >65535 is not a port at all. The regex
    // bounds the digit count; this bounds the value.
    if (port < 1 || port > 65535) continue;
    if (seen.has(url)) continue;

    seen.add(url);
    targets.push({ url, port });
    if (targets.length >= MAX_DEV_PREVIEWS) break;
  }

  return targets;
}
