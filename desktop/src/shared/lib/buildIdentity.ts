/**
 * Formatting for the build's identity stamp.
 *
 * Pure so the wording can be unit-tested without a Tauri handle. The values
 * come from `get_build_info`, baked in at compile time by `build.rs`.
 */

export type BuildInfo = {
  version: string;
  gitSha: string;
  gitDirty: boolean;
  builtAt: number;
  profile: string;
  isDev: boolean;
};

/** `2026-08-30 13:02`, in the reader's local time. Empty when unknown. */
export function formatBuiltAt(builtAt: number): string {
  if (!Number.isFinite(builtAt) || builtAt <= 0) return "";
  const d = new Date(builtAt * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * One-line stamp for the settings footer: `v0.5.20 · 91798ba8 · 13:02`.
 *
 * Deliberately short — it sits in a sidebar footer. The full detail lives in
 * the logo tooltip.
 */
export function formatBuildStamp(info: BuildInfo | null): string {
  if (!info) return "";
  const parts = [`v${info.version}`];
  if (info.gitSha && info.gitSha !== "unknown") {
    parts.push(info.gitDirty ? `${info.gitSha}+` : info.gitSha);
  }
  const at = formatBuiltAt(info.builtAt);
  if (at) parts.push(at.slice(11));
  return parts.join(" · ");
}

/**
 * Full multi-line detail, shown on hover over the settings stamp.
 *
 * Says "compiled", not "built", and says why: the `.app` is written minutes
 * after the compiler stamps the binary, so its file date is always later. That
 * gap looked like a discrepancy the first time someone compared the two.
 *
 * `+` after the commit means the working tree had uncommitted changes, so the
 * commit alone does not describe what is running.
 */
export function formatBuildTooltip(info: BuildInfo | null): string {
  if (!info) return "";
  const lines = [`Buzz ${info.version}${info.isDev ? " (dev)" : ""}`];
  if (info.gitSha && info.gitSha !== "unknown") {
    lines.push(
      `commit ${info.gitSha}${info.gitDirty ? " + uncommitted changes" : ""}`,
    );
  }
  const at = formatBuiltAt(info.builtAt);
  if (at) {
    lines.push(`compiled ${at}`);
    lines.push("(the .app file is packaged a few minutes later)");
  }
  return lines.join("\n");
}
