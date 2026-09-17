/**
 * Keep one Pi shell command from monopolising an otherwise long-lived turn.
 *
 * The model turn intentionally has no short wall-clock limit. This extension
 * applies a separate default to the bash tool: a command that needs longer
 * must say so explicitly. That preserves quality time for the model while
 * making recursive searches, hung watchers and broken builds recoverable.
 */
import { createBashTool, createReadTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 86_400;

// Reading one of these hands the model an image block. The combo behind this
// pilot has no vision model, so the block is not merely useless: it is
// permanently unservable, and because pi resumes a session by id it poisons
// every later attempt at the same job with `400 capability_mismatch`. One
// stray `read` of a PNG cost the coder a completed seven-minute run and left
// the job unrunnable until its session was quarantined.
const UNVIEWABLE = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|avif|heic|pdf)$/i;

function secondsFromEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMEOUT_SECONDS) {
		throw new Error(`${name} must be between 1 and ${MAX_TIMEOUT_SECONDS} seconds`);
	}
	return value;
}

export default function piCommandGuard(pi: ExtensionAPI) {
	if (process.env.BUZZ_PI_COMMAND_GUARD === "0") return;

	const defaultTimeout = secondsFromEnv(
		"BUZZ_PI_COMMAND_TIMEOUT",
		DEFAULT_TIMEOUT_SECONDS,
	);
	const bashTool = createBashTool(process.cwd());

	const readTool = createReadTool(process.cwd());

	pi.registerTool({
		...readTool,
		execute: async (id, params, signal, onUpdate, ctx) => {
			const path = String((params as { path?: unknown }).path ?? "");
			if (UNVIEWABLE.test(path)) {
				// Refuse with the alternative, not only the rule: an error the
				// model cannot act on costs a turn and teaches nothing.
				throw new Error(
					`read cannot open ${path}: this pilot's model combo has no vision, ` +
						"and an image in the transcript makes the whole session unreplayable. " +
						"Use `ls -l` for its size, `file` for its type, or read the code that " +
						"produces it.",
				);
			}
			return readTool.execute(id, params, signal, onUpdate, ctx);
		},
	});

	pi.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, ctx) => {
			const timeout = params.timeout ?? defaultTimeout;
			if (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_SECONDS) {
				throw new Error(
					`bash timeout must be between 1 and ${MAX_TIMEOUT_SECONDS} seconds`,
				);
			}
			return bashTool.execute(
				id,
				{ ...params, timeout },
				signal,
				onUpdate,
				ctx,
			);
		},
	});
}
