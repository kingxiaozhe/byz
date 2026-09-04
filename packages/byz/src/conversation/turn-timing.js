function clampMilliseconds(value) {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function formatElapsed(milliseconds, language = "zh") {
	const totalSeconds = Math.floor(clampMilliseconds(milliseconds) / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = String(totalSeconds % 60).padStart(2, "0");
	return language === "en" ? `${minutes}m ${seconds}s` : `${minutes}分${seconds}秒`;
}

export function createTurnTiming(options = {}) {
	const now = options.now ?? (() => performance.now());
	const stageTotals = new Map();
	const stageOrder = [];
	const waitingTotals = new Map([
		["confirmation", 0],
		["pause", 0],
	]);
	let currentStage;
	let activeStartedAt;
	let waitingStartedAt;
	let waitingReason;
	let lastNow = 0;
	let finished = false;
	let finalSnapshot;

	function readNow() {
		const value = clampMilliseconds(now());
		lastNow = Math.max(lastNow, value);
		return lastNow;
	}

	function rememberStage(stage) {
		if (!stageTotals.has(stage)) {
			stageTotals.set(stage, 0);
			stageOrder.push(stage);
		}
	}

	function settleActive(at) {
		if (currentStage === undefined || activeStartedAt === undefined) return;
		stageTotals.set(currentStage, (stageTotals.get(currentStage) ?? 0) + Math.max(0, at - activeStartedAt));
		activeStartedAt = undefined;
	}

	function settleWaiting(at) {
		if (waitingStartedAt === undefined || waitingReason === undefined) return;
		waitingTotals.set(waitingReason, (waitingTotals.get(waitingReason) ?? 0) + Math.max(0, at - waitingStartedAt));
		waitingStartedAt = undefined;
		waitingReason = undefined;
	}

	function snapshotAt(at) {
		const stages = stageOrder.map((stage) => {
			const active = stage === currentStage && activeStartedAt !== undefined ? Math.max(0, at - activeStartedAt) : 0;
			return { stage, milliseconds: (stageTotals.get(stage) ?? 0) + active };
		});
		const currentWaiting = waitingStartedAt === undefined ? 0 : Math.max(0, at - waitingStartedAt);
		const confirmationWaitingMs =
			(waitingTotals.get("confirmation") ?? 0) + (waitingReason === "confirmation" ? currentWaiting : 0);
		const pauseWaitingMs = (waitingTotals.get("pause") ?? 0) + (waitingReason === "pause" ? currentWaiting : 0);
		const activeMs = stages.reduce((sum, entry) => sum + entry.milliseconds, 0);
		const waitingMs = confirmationWaitingMs + pauseWaitingMs;
		return {
			activeMs,
			confirmationWaitingMs,
			currentStage,
			currentStageMs: stages.find((entry) => entry.stage === currentStage)?.milliseconds ?? 0,
			finished,
			pauseWaitingMs,
			stages,
			totalMs: activeMs + waitingMs,
			waiting: waitingReason !== undefined,
			waitingMs,
			waitingReason,
		};
	}

	function pause(reason) {
		if (finished || waitingReason !== undefined || !waitingTotals.has(reason)) return false;
		const at = readNow();
		settleActive(at);
		waitingReason = reason;
		waitingStartedAt = at;
		return true;
	}

	function resume(reason) {
		if (finished || waitingReason !== reason || waitingStartedAt === undefined) return false;
		const at = readNow();
		settleWaiting(at);
		if (currentStage !== undefined) activeStartedAt = at;
		return true;
	}

	return Object.freeze({
		start(stage) {
			if (finished || currentStage !== undefined) return;
			const at = readNow();
			currentStage = stage;
			rememberStage(stage);
			activeStartedAt = at;
		},
		transition(stage) {
			if (finished || !stage || stage === currentStage) return;
			const at = readNow();
			settleActive(at);
			currentStage = stage;
			rememberStage(stage);
			if (waitingReason === undefined) activeStartedAt = at;
		},
		pause,
		resume,
		pauseForConfirmation() {
			return pause("confirmation");
		},
		resumeAfterConfirmation() {
			return resume("confirmation");
		},
		snapshot() {
			return finalSnapshot ?? snapshotAt(readNow());
		},
		finish() {
			if (finalSnapshot) return finalSnapshot;
			const at = readNow();
			settleActive(at);
			settleWaiting(at);
			finished = true;
			const snapshot = snapshotAt(at);
			finalSnapshot = Object.freeze({
				...snapshot,
				stages: Object.freeze(snapshot.stages.map((entry) => Object.freeze(entry))),
			});
			return finalSnapshot;
		},
	});
}
