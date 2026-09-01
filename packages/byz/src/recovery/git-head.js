import { spawn as nodeSpawn } from "node:child_process";

const GIT_ARGUMENTS = Object.freeze(["rev-parse", "--verify", "HEAD"]);
const TIMEOUT_MS = 1_000;
const STDOUT_LIMIT_BYTES = 128;
const STDERR_LIMIT_BYTES = 1_024;
const SHORT_HEAD_LENGTH = 12;
const PROCESS_DISCOVERY_ENV_KEYS = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT"];

const unavailable = (reasonCode) => Object.freeze({ state: "unavailable", reasonCode });

function createGitEnvironment() {
	const environment = {
		GIT_OPTIONAL_LOCKS: "0",
		GIT_TERMINAL_PROMPT: "0",
	};
	for (const key of PROCESS_DISCOVERY_ENV_KEYS) {
		if (typeof process.env[key] === "string") environment[key] = process.env[key];
	}
	return environment;
}

/**
 * Creates a details-only Git HEAD reader. Construction is inert: Git is spawned
 * only when the returned function is explicitly called. Successful reads return
 * exactly 12 lower-case hexadecimal characters.
 */
export function createGitHeadReader({ spawn = nodeSpawn } = {}) {
	if (typeof spawn !== "function") {
		throw new TypeError("spawn must be a function");
	}

	return function readGitHead(cwd) {
		return new Promise((resolve) => {
			let child;
			try {
				child = spawn("git", [...GIT_ARGUMENTS], {
					cwd,
					env: createGitEnvironment(),
					shell: false,
					stdio: ["ignore", "pipe", "pipe"],
				});
			} catch {
				resolve(unavailable("git-unavailable"));
				return;
			}

			let settled = false;
			let stdoutBytes = 0;
			let stderrBytes = 0;
			const stdoutChunks = [];

			const finish = (result, terminate = false) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				if (terminate) child.kill("SIGKILL");
				resolve(result);
			};

			const timer = setTimeout(() => {
				finish(unavailable("timeout"), true);
			}, TIMEOUT_MS);

			child.stdout.on("data", (chunk) => {
				stdoutBytes += chunk.length;
				if (stdoutBytes > STDOUT_LIMIT_BYTES) {
					finish(unavailable("output-overflow"), true);
					return;
				}
				stdoutChunks.push(chunk);
			});

			child.stderr.on("data", (chunk) => {
				stderrBytes += chunk.length;
				if (stderrBytes > STDERR_LIMIT_BYTES) {
					finish(unavailable("output-overflow"), true);
				}
			});

			child.once("error", () => finish(unavailable("git-unavailable")));
			child.once("close", (code) => {
				if (code !== 0) {
					finish(unavailable("command-failed"));
					return;
				}

				const output = Buffer.concat(stdoutChunks).toString("utf8");
				const match = /^(?<head>[0-9a-f]{40}|[0-9a-f]{64})(?:\r?\n)?$/.exec(output);
				if (!match?.groups) {
					finish(unavailable("invalid-output"));
					return;
				}

				finish(match.groups.head.slice(0, SHORT_HEAD_LENGTH));
			});
		});
	};
}

export const readGitHead = createGitHeadReader();
