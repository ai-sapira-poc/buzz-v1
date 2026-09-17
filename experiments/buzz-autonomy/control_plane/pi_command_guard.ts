/**
 * Keep one Pi shell command from monopolising an otherwise long-lived turn.
 *
 * The model turn intentionally has no short wall-clock limit. This extension
 * applies a separate default to the bash tool: a command that needs longer
 * must say so explicitly. That preserves quality time for the model while
 * making recursive searches, hung watchers and broken builds recoverable.
 */
import { createBashTool } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 86_400;

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
