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
	let currentStage;
	let activeStartedAt;
	let waitingStartedAt;
	let waitingMs = 0;
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
		if (waitingStartedAt === undefined) return;
		waitingMs += Math.max(0, at - waitingStartedAt);
		waitingStartedAt = undefined;
	}

	function snapshotAt(at) {
		const stages = stageOrder.map((stage) => {
			const active = stage === currentStage && activeStartedAt !== undefined ? Math.max(0, at - activeStartedAt) : 0;
			return { stage, milliseconds: (stageTotals.get(stage) ?? 0) + active };
		});
		const currentWaiting = waitingStartedAt === undefined ? 0 : Math.max(0, at - waitingStartedAt);
		const activeMs = stages.reduce((sum, entry) => sum + entry.milliseconds, 0);
		const totalWaitingMs = waitingMs + currentWaiting;
		return {
			activeMs,
			currentStage,
			currentStageMs: stages.find((entry) => entry.stage === currentStage)?.milliseconds ?? 0,
			finished,
			stages,
			totalMs: activeMs + totalWaitingMs,
			waiting: waitingStartedAt !== undefined,
			waitingMs: totalWaitingMs,
		};
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
			if (waitingStartedAt === undefined) activeStartedAt = at;
		},
		pauseForConfirmation() {
			if (finished || waitingStartedAt !== undefined) return;
			const at = readNow();
			settleActive(at);
			waitingStartedAt = at;
		},
		resumeAfterConfirmation() {
			if (finished || waitingStartedAt === undefined) return;
			const at = readNow();
			settleWaiting(at);
			if (currentStage !== undefined) activeStartedAt = at;
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
