import { Worker } from "node:worker_threads";
import { valid } from "semver";
import { getDiagnosticsHome, isDetailMode, readDiagnosticsConfig } from "./config.js";
import { bucketDropped, validateDiagnosticEvent } from "./schema.js";

function safeUpdateData(data, includeOutcome = false) {
	if (!data || valid(data.fromVersion) !== data.fromVersion || valid(data.toVersion) !== data.toVersion)
		return undefined;
	const identity = /^node-\d+-(aix|darwin|freebsd|linux|openbsd|sunos|win32)$/.test(data.identity)
		? data.identity
		: "unknown";
	return {
		fromVersion: data.fromVersion,
		toVersion: data.toVersion,
		identity,
		...(includeOutcome ? { outcome: data.outcome === "success" ? "success" : "command_failed" } : {}),
	};
}

const NOOP_RECORDER = Object.freeze({
	enabled: false,
	detail: false,
	record() {},
	captureUpdateBaseline() {},
	recordUpdateResult() {},
	close() {},
});

export function createDiagnosticsRecorder(options = {}) {
	try {
		const home = options.home ?? getDiagnosticsHome(options.env);
		const config = options.config ?? readDiagnosticsConfig(home);
		if (!config.enabled) return NOOP_RECORDER;
		const maxInFlight = options.maxInFlight ?? 256;
		const createWorker = options.createWorker ?? ((url, workerOptions) => new Worker(url, workerOptions));
		const worker = createWorker(new URL("./writer-worker.js", import.meta.url), {
			workerData: {
				home,
				generation: config.generation,
				retentionDays: config.retentionDays,
				maxBytes: config.maxBytes,
			},
		});
		let active = true;
		let nextId = 1;
		let inFlight = 0;
		let dropped = 0;

		const postMessage = (message) => {
			if (!active || inFlight >= maxInFlight) {
				dropped++;
				return;
			}
			try {
				inFlight++;
				worker.postMessage({ ...message, id: nextId++ });
			} catch {
				inFlight = Math.max(0, inFlight - 1);
				dropped++;
			}
		};

		const flushDropSummary = () => {
			if (dropped === 0 || inFlight >= maxInFlight || !active) return;
			const count = dropped;
			dropped = 0;
			const event = validateDiagnosticEvent("byz.diagnostics.degrade", {
				component: "recorder",
				reason: "queue_full",
				dropped_bucket: bucketDropped(count),
				error_site: "unknown",
			});
			if (event) postMessage({ type: "record", event });
		};

		worker.on?.("message", (message) => {
			try {
				if (message?.type !== "ack") return;
				inFlight = Math.max(0, inFlight - 1);
				if (message.reason) active = false;
				else flushDropSummary();
			} catch {
				active = false;
			}
		});
		worker.on?.("error", () => {
			active = false;
		});
		worker.on?.("exit", () => {
			active = false;
		});
		// Adding Worker listeners can ref its MessagePort again. Unref only after
		// all lifecycle listeners are installed so idle diagnostics never keep a
		// BYZ command alive.
		worker.unref?.();

		return Object.freeze({
			enabled: true,
			detail: isDetailMode(config),
			record(eventName, attributes) {
				try {
					const event = validateDiagnosticEvent(eventName, attributes);
					if (event) postMessage({ type: "record", event });
					else dropped++;
				} catch {
					dropped++;
				}
			},
			captureUpdateBaseline(data) {
				try {
					const safe = safeUpdateData(data);
					if (safe) postMessage({ type: "capture-update", data: safe });
					else dropped++;
				} catch {
					dropped++;
				}
			},
			recordUpdateResult(data) {
				try {
					const safe = safeUpdateData(data, true);
					if (safe) postMessage({ type: "update-result", data: safe });
					else dropped++;
				} catch {
					dropped++;
				}
			},
			close() {
				try {
					active = false;
					worker.unref?.();
					void worker.terminate?.();
				} catch {
					// Closing diagnostics is best effort and never flushes.
				}
			},
		});
	} catch {
		return NOOP_RECORDER;
	}
}

export { NOOP_RECORDER };
