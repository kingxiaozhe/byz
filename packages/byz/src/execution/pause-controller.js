const TERMINAL_STATES = new Set(["idle", "stale"]);

function deferred() {
	let resolve;
	const promise = new Promise((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function freezeSnapshot(value) {
	return Object.freeze({
		boundary: value.boundary,
		generation: value.generation,
		pausedRegistrySnapshot: value.pausedRegistrySnapshot,
		reason: value.reason,
		state: value.state,
		waitingMs: value.waitingMs,
	});
}

export function createPauseController(options = {}) {
	const now = options.now ?? (() => performance.now());
	const readRegistrySnapshot = options.readRegistrySnapshot ?? (() => undefined);
	const listeners = new Set();
	const admitted = new Map();
	const inFlight = new Map();
	let generation = 0;
	let state = "idle";
	let boundary;
	let requestedAt;
	let pausedAt;
	let pausedRegistrySnapshot;
	let gate;
	let drain;
	let confirmationGeneration;
	let operationSequence = 0;

	function waitingMs() {
		const started = state === "paused" || state === "resuming" ? pausedAt : requestedAt;
		return started === undefined ? 0 : Math.max(0, Math.floor(now() - started));
	}

	function snapshot() {
		return freezeSnapshot({ boundary, generation, pausedRegistrySnapshot, state, waitingMs: waitingMs() });
	}

	function publishSnapshot(current) {
		for (const listener of listeners) {
			try {
				listener(current);
			} catch {
				// Presentation observers cannot alter or strand the pause state machine.
			}
		}
		return current;
	}

	function publish() {
		return publishSnapshot(snapshot());
	}

	function toolsDrained() {
		return admitted.size === 0 && inFlight.size === 0;
	}

	function notifyDrain() {
		if (!toolsDrained() || !drain) return;
		const current = drain;
		drain = undefined;
		current.resolve();
	}

	function clearTools() {
		admitted.clear();
		inFlight.clear();
		notifyDrain();
	}

	function finishGate(outcome, nextState) {
		operationSequence += 1;
		const current = gate;
		gate = undefined;
		boundary = undefined;
		requestedAt = undefined;
		pausedAt = undefined;
		pausedRegistrySnapshot = undefined;
		state = nextState;
		current?.resolve(outcome);
		publish();
		return Boolean(current);
	}

	async function waitAbortable(promise, signal, cancelledValue) {
		if (!signal) return promise;
		if (signal.aborted) return cancelledValue;
		return new Promise((resolve) => {
			let settled = false;
			const finish = (value) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", abort);
				resolve(value);
			};
			const abort = () => finish(cancelledValue);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
			void promise.then(finish);
		});
	}

	async function waitForDrain(expectedGeneration, expectedSequence, signal) {
		if (signal?.aborted) return false;
		if (!toolsDrained()) {
			drain ??= deferred();
			if (
				!(await waitAbortable(
					drain.promise.then(() => true),
					signal,
					false,
				))
			)
				return false;
		}
		return !signal?.aborted && generation === expectedGeneration && operationSequence === expectedSequence;
	}

	return Object.freeze({
		startRun() {
			if (!TERMINAL_STATES.has(state)) return snapshot();
			generation += 1;
			operationSequence += 1;
			state = "running";
			boundary = undefined;
			requestedAt = undefined;
			pausedAt = undefined;
			pausedRegistrySnapshot = undefined;
			gate = undefined;
			confirmationGeneration = undefined;
			clearTools();
			return publish();
		},
		request() {
			if (confirmationGeneration === generation)
				return { accepted: false, reason: "confirmation", snapshot: snapshot() };
			if (state === "requested" || state === "paused" || state === "resuming") {
				return { accepted: true, reason: "duplicate", snapshot: snapshot() };
			}
			if (state !== "running") return { accepted: false, reason: "idle", snapshot: snapshot() };
			operationSequence += 1;
			state = "requested";
			requestedAt = now();
			return { accepted: true, reason: "requested", snapshot: publish() };
		},
		admitBatch(toolCalls) {
			if (state !== "running" || !Array.isArray(toolCalls)) return false;
			let admittedAny = false;
			for (const tool of toolCalls) {
				const toolCallId = tool?.toolCallId;
				if (typeof toolCallId !== "string" || toolCallId.length === 0 || admitted.has(toolCallId)) continue;
				admitted.set(toolCallId, generation);
				admittedAny = true;
			}
			return admittedAny;
		},
		admitTool(toolCallId) {
			if (typeof toolCallId !== "string" || toolCallId.length === 0) return false;
			if (admitted.get(toolCallId) === generation) return true;
			if (state !== "running" || inFlight.has(toolCallId)) return false;
			admitted.set(toolCallId, generation);
			return true;
		},
		toolStarted(toolCallId) {
			if (admitted.get(toolCallId) !== generation) return false;
			inFlight.set(toolCallId, generation);
			return true;
		},
		toolEnded(toolCallId) {
			const matched = admitted.delete(toolCallId) || inFlight.has(toolCallId);
			inFlight.delete(toolCallId);
			notifyDrain();
			return matched;
		},
		async reachBoundary(kind, signal) {
			if (state === "running") return "resumed";
			if (state !== "requested" && state !== "paused") return "cancelled";
			const expectedGeneration = generation;
			const expectedSequence = operationSequence;
			if (!(await waitForDrain(expectedGeneration, expectedSequence, signal))) return "cancelled";
			if (state === "requested") {
				let registrySnapshot;
				try {
					registrySnapshot = readRegistrySnapshot();
				} catch {
					const failed = freezeSnapshot({
						boundary: kind === "tool" ? "tool" : "model",
						generation,
						reason: "registry_unavailable",
						state: "running",
						waitingMs: waitingMs(),
					});
					operationSequence += 1;
					boundary = undefined;
					requestedAt = undefined;
					pausedAt = undefined;
					pausedRegistrySnapshot = undefined;
					state = "running";
					publishSnapshot(failed);
					return "cancelled";
				}
				state = "paused";
				boundary = kind === "tool" ? "tool" : "model";
				pausedAt = now();
				pausedRegistrySnapshot = registrySnapshot;
				gate = deferred();
				try {
					options.onPause?.(generation);
				} catch {
					// Timing integrations are observers and cannot strand the gate.
				}
				publish();
			}
			if (!gate || generation !== expectedGeneration) return "cancelled";
			const outcome = await waitAbortable(gate.promise, signal, "cancelled");
			return generation === expectedGeneration ? outcome : "cancelled";
		},
		resume(expectedGeneration = generation) {
			if (state !== "paused" || expectedGeneration !== generation || !gate) return false;
			state = "resuming";
			publish();
			try {
				options.onResume?.(generation);
			} catch {
				// Timing integrations are observers and cannot strand the gate.
			}
			return finishGate("resumed", "running");
		},
		cancel() {
			if ((state === "requested" && !gate) || state === "paused" || state === "resuming") {
				finishGate("cancelled", "running");
				return true;
			}
			return false;
		},
		settle(reason = "settled") {
			clearTools();
			confirmationGeneration = undefined;
			return finishGate("cancelled", reason === "reload" ? "stale" : "idle");
		},
		beginConfirmation() {
			if (state !== "running") return undefined;
			confirmationGeneration = generation;
			return generation;
		},
		endConfirmation(expectedGeneration) {
			if (confirmationGeneration !== expectedGeneration) return false;
			confirmationGeneration = undefined;
			return true;
		},
		isConfirmationActive() {
			return confirmationGeneration === generation;
		},
		snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return Object.freeze({ dispose: () => listeners.delete(listener) });
		},
	});
}
