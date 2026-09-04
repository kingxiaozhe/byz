import { randomUUID } from "node:crypto";
import {
	canonicalize,
	deepFreeze,
	EXECUTION_LIMITS,
	hasExactKeys,
	isBoundedId,
	isPlainObject,
	isTestCaseId,
	normalizeTasks,
} from "./execution-schema.js";

const TASK_TERMINAL_STATES = new Set(["completed", "cancelled"]);
const FINISH_OUTCOMES = new Set(["completed", "blocked", "cancelled"]);
const TOOL_CATEGORIES = new Set(["inspect", "mutation", "command", "other"]);
const COMMAND_CATEGORIES = new Set(["test", "check", "build", "git", "generic"]);
const OBSERVED_CATEGORIES = new Set([...TOOL_CATEGORIES, ...COMMAND_CATEGORIES]);
const EVIDENCE_BASES = new Set(["declared", "latest_observed"]);
const VERIFIED_OUTCOMES = new Set(["passed", "failed"]);
const VERIFIED_CATEGORIES = new Set(["test", "check", "build", "review", "qa"]);

function createEmptyState(generation = 0) {
	return {
		availability: "empty",
		generation,
		sequence: 0,
		plan: undefined,
		inFlight: new Map(),
	};
}

function cloneState(state) {
	return {
		availability: state.availability,
		generation: state.generation,
		sequence: state.sequence,
		reasonCode: state.reasonCode,
		plan: state.plan
			? {
					...state.plan,
					order: [...state.plan.order],
					tasks: new Map([...state.plan.tasks].map(([id, task]) => [id, { ...task }])),
					evidence: state.plan.evidence.map((receipt) => ({ ...receipt })),
				}
			: undefined,
		inFlight: new Map([...state.inFlight].map(([id, receipt]) => [id, { ...receipt }])),
	};
}

function taskCounts(plan) {
	const counts = { completed: 0, blocked: 0, cancelled: 0 };
	for (const task of plan.tasks.values()) {
		if (task.status in counts) counts[task.status] += 1;
	}
	return counts;
}

function evidenceCounts(plan) {
	const counts = {
		declaredEvidence: 0,
		observedEvidence: 0,
		verifiedEvidence: 0,
		verifiedPassedEvidence: 0,
		verifiedFailedEvidence: 0,
		verifiedPassedCategories: new Set(),
		verifiedFailedCategories: new Set(),
	};
	for (const receipt of plan.evidence) {
		if (receipt.provenance === "declared") counts.declaredEvidence += 1;
		if (receipt.provenance === "observed") counts.observedEvidence += 1;
		if (receipt.provenance === "verified") {
			counts.verifiedEvidence += 1;
			if (receipt.outcome === "passed") {
				counts.verifiedPassedEvidence += 1;
				if (VERIFIED_CATEGORIES.has(receipt.category)) counts.verifiedPassedCategories.add(receipt.category);
			}
			if (receipt.outcome === "failed") {
				counts.verifiedFailedEvidence += 1;
				if (VERIFIED_CATEGORIES.has(receipt.category)) counts.verifiedFailedCategories.add(receipt.category);
			}
		}
	}
	const verifiedPassedCategories = [...counts.verifiedPassedCategories].sort();
	const verifiedFailedCategories = [...counts.verifiedFailedCategories].sort();
	return {
		declaredEvidence: counts.declaredEvidence,
		observedEvidence: counts.observedEvidence,
		verifiedEvidence: counts.verifiedEvidence,
		verifiedPassedEvidence: counts.verifiedPassedEvidence,
		verifiedFailedEvidence: counts.verifiedFailedEvidence,
		...(verifiedPassedCategories.length > 0 ? { verifiedPassedCategories } : {}),
		...(verifiedFailedCategories.length > 0 ? { verifiedFailedCategories } : {}),
	};
}

function snapshotState(state) {
	if (state.availability === "empty") return deepFreeze({ availability: "empty", generation: state.generation });
	if (state.availability === "unavailable") {
		return deepFreeze({ availability: "unavailable", generation: state.generation, reasonCode: "invalid_record" });
	}
	const plan = state.plan;
	const counts = { ...taskCounts(plan), ...evidenceCounts(plan) };
	const activeId = plan.order.find((id) => plan.tasks.get(id)?.status === "active");
	const active = activeId ? { id: activeId, ordinal: plan.order.indexOf(activeId) + 1 } : undefined;
	return deepFreeze({
		availability: "available",
		generation: state.generation,
		plan: {
			id: plan.id,
			state: plan.state,
			...(plan.state === "drafting" ? {} : { total: plan.order.length }),
			...(active && plan.state !== "drafting" ? { active } : {}),
			counts,
		},
	});
}

function reject(errorCode) {
	return { accepted: false, errorCode };
}

function success(state) {
	const snapshot = snapshotState(state);
	return { accepted: true, planId: state.plan.id, counts: snapshot.plan.counts };
}

function updatePlanState(plan) {
	if (plan.state === "drafting") return;
	plan.state = plan.order.every((id) => TASK_TERMINAL_STATES.has(plan.tasks.get(id).status)) ? "terminal" : "sealed";
}

function validateReceiptEnvelope(receipt) {
	if (!hasExactKeys(receipt, ["schemaVersion", "sequence", "generation", "planId", "action", "payload"])) return false;
	return (
		receipt.schemaVersion === 1 &&
		Number.isSafeInteger(receipt.sequence) &&
		receipt.sequence > 0 &&
		Number.isSafeInteger(receipt.generation) &&
		receipt.generation > 0 &&
		isBoundedId(receipt.planId) &&
		typeof receipt.action === "string" &&
		isPlainObject(receipt.payload)
	);
}

function openPlan(state, receipt) {
	if (receipt.generation !== state.generation + 1 || !hasExactKeys(receipt.payload, ["tasks"]))
		return reject("invalid_record");
	const tasks = normalizeTasks(receipt.payload.tasks);
	if (!tasks) return reject("invalid_record");
	state.availability = "available";
	state.generation = receipt.generation;
	state.plan = {
		id: receipt.planId,
		state: "drafting",
		order: tasks.map((task) => task.id),
		tasks: new Map(tasks.map((task) => [task.id, { ...task, status: "pending" }])),
		evidence: [],
	};
	state.inFlight = new Map();
	return { accepted: true, changed: true };
}

function requireCurrentPlan(state, receipt) {
	if (state.availability !== "available" || !state.plan) return reject("no_plan");
	if (receipt.generation !== state.generation || receipt.planId !== state.plan.id) return reject("stale_plan");
	return undefined;
}

function sealPlan(state, payload) {
	if (!hasExactKeys(payload, [])) return reject("invalid_record");
	if (state.plan.state === "sealed" || state.plan.state === "terminal") return { accepted: true, changed: false };
	if (state.plan.state !== "drafting") return reject("invalid_transition");
	state.plan.state = "sealed";
	return { accepted: true, changed: true };
}

function startTask(state, payload) {
	if (!hasExactKeys(payload, ["taskId"]) || !isBoundedId(payload.taskId)) return reject("invalid_record");
	if (state.plan.state === "drafting") return reject("plan_not_sealed");
	const task = state.plan.tasks.get(payload.taskId);
	if (!task) return reject("unknown_task");
	if (task.status === "active") return { accepted: true, changed: false };
	if (task.status !== "pending") return reject("invalid_transition");
	if ([...state.plan.tasks.values()].some((candidate) => candidate.status === "active"))
		return reject("active_task_exists");
	task.status = "active";
	updatePlanState(state.plan);
	return { accepted: true, changed: true };
}

function finishTask(state, payload) {
	if (
		!hasExactKeys(payload, ["taskId", "outcome"]) ||
		!isBoundedId(payload.taskId) ||
		!FINISH_OUTCOMES.has(payload.outcome)
	) {
		return reject("invalid_record");
	}
	const task = state.plan.tasks.get(payload.taskId);
	if (!task) return reject("unknown_task");
	if (task.status === payload.outcome) return { accepted: true, changed: false };
	if (task.status !== "active") return reject("invalid_transition");
	if ([...state.inFlight.values()].some((receipt) => receipt.taskId === payload.taskId))
		return reject("tools_in_flight");
	task.status = payload.outcome;
	updatePlanState(state.plan);
	return { accepted: true, changed: true };
}

function resumeTask(state, payload) {
	if (!hasExactKeys(payload, ["taskId"]) || !isBoundedId(payload.taskId)) return reject("invalid_record");
	const task = state.plan.tasks.get(payload.taskId);
	if (!task) return reject("unknown_task");
	if (task.status === "active") return { accepted: true, changed: false };
	if (task.status !== "blocked") return reject("invalid_transition");
	if ([...state.plan.tasks.values()].some((candidate) => candidate.status === "active"))
		return reject("active_task_exists");
	task.status = "active";
	updatePlanState(state.plan);
	return { accepted: true, changed: true };
}

function addEvidence(state, payload, provenance) {
	if (state.plan.evidence.length >= EXECUTION_LIMITS.receipts) return reject("receipt_limit");
	state.plan.evidence.push({ ...payload, provenance });
	return { accepted: true, changed: true };
}

function addDeclaredEvidence(state, payload) {
	if (!hasExactKeys(payload, ["taskId", "kind", "basis"])) return reject("invalid_record");
	if (!isBoundedId(payload.taskId) || !isBoundedId(payload.kind) || !EVIDENCE_BASES.has(payload.basis)) {
		return reject("invalid_record");
	}
	if (!state.plan.tasks.has(payload.taskId)) return reject("unknown_task");
	return addEvidence(state, payload, "declared");
}

function addObservedEvidence(state, payload) {
	if (!hasExactKeys(payload, ["taskId", "toolCallId", "category", "outcome"])) return reject("invalid_record");
	if (
		!isBoundedId(payload.taskId) ||
		!isBoundedId(payload.toolCallId) ||
		!OBSERVED_CATEGORIES.has(payload.category) ||
		!new Set(["success", "failure"]).has(payload.outcome)
	) {
		return reject("invalid_record");
	}
	if (!state.plan.tasks.has(payload.taskId)) return reject("unknown_task");
	return addEvidence(state, payload, "observed");
}

function addVerifiedEvidence(state, payload) {
	if (
		!hasExactKeys(payload, ["source", "taskId", "testCaseId", "outcome"]) &&
		!hasExactKeys(payload, ["source", "taskId", "testCaseId", "outcome", "category"])
	)
		return reject("invalid_record");
	if (
		!isBoundedId(payload.source) ||
		!isBoundedId(payload.taskId) ||
		!isTestCaseId(payload.testCaseId) ||
		!VERIFIED_OUTCOMES.has(payload.outcome) ||
		(payload.category !== undefined && !VERIFIED_CATEGORIES.has(payload.category))
	) {
		return reject("invalid_record");
	}
	if (!state.plan.tasks.has(payload.taskId)) return reject("unknown_task");
	return addEvidence(state, payload, "verified");
}

function applyReceipt(state, receipt) {
	if (!validateReceiptEnvelope(receipt)) return reject("invalid_record");
	if (receipt.action === "plan_open") return openPlan(state, receipt);
	const currentError = requireCurrentPlan(state, receipt);
	if (currentError) return currentError;
	const reducers = {
		plan_seal: sealPlan,
		task_start: startTask,
		task_finish: finishTask,
		task_resume: resumeTask,
		evidence_add: addDeclaredEvidence,
		tool_observed: addObservedEvidence,
		evidence_verified: addVerifiedEvidence,
	};
	const reducer = reducers[receipt.action];
	return reducer ? reducer(state, receipt.payload) : reject("invalid_record");
}

function normalizeDispatch(input) {
	if (!isPlainObject(input) || typeof input.action !== "string") return undefined;
	const keys = {
		plan_open: ["action", "tasks"],
		plan_seal: ["action", "planId"],
		task_start: ["action", "planId", "taskId"],
		task_finish: ["action", "planId", "taskId", "outcome"],
		task_resume: ["action", "planId", "taskId"],
		evidence_add: ["action", "planId", "taskId", "kind", "basis"],
	};
	if (!keys[input.action] || !hasExactKeys(input, keys[input.action])) return undefined;
	if (input.action === "plan_open") {
		const tasks = normalizeTasks(input.tasks);
		return tasks ? { action: input.action, payload: { tasks } } : undefined;
	}
	if (!isBoundedId(input.planId)) return undefined;
	if (input.action === "plan_seal") return { action: input.action, planId: input.planId, payload: {} };
	if (!isBoundedId(input.taskId)) return undefined;
	if (input.action === "task_start" || input.action === "task_resume") {
		return { action: input.action, planId: input.planId, payload: { taskId: input.taskId } };
	}
	if (input.action === "task_finish") {
		if (!FINISH_OUTCOMES.has(input.outcome)) return undefined;
		return { action: input.action, planId: input.planId, payload: { taskId: input.taskId, outcome: input.outcome } };
	}
	if (!isBoundedId(input.kind) || !EVIDENCE_BASES.has(input.basis)) return undefined;
	return {
		action: input.action,
		planId: input.planId,
		payload: { taskId: input.taskId, kind: input.kind, basis: input.basis },
	};
}

function damagedGeneration(state, claimedGeneration) {
	if (state.generation > 0) return state.generation;
	return claimedGeneration === 1 ? 1 : 0;
}

function unavailableState(generation, sequence = 0) {
	return {
		availability: "unavailable",
		generation: Number.isSafeInteger(generation) && generation > 0 ? generation : 0,
		sequence: Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0,
		reasonCode: "invalid_record",
		plan: undefined,
		inFlight: new Map(),
	};
}

export function createExecutionRegistry(options = {}) {
	if (typeof options.appendReceipt !== "function") throw new Error("Execution registry requires appendReceipt.");
	const createPlanId =
		options.createPlanId ?? ((generation) => `plan-${generation}-${randomUUID().replaceAll("-", "")}`);
	const verifyReceipt = options.verifyReceipt ?? (() => false);
	const subscribers = new Set();
	let state = createEmptyState();

	function publish() {
		const snapshot = snapshotState(state);
		for (const subscriber of subscribers) {
			try {
				subscriber(snapshot);
			} catch {}
		}
	}

	function commit(receipt, prepareProposal) {
		const proposal = cloneState(state);
		prepareProposal?.(proposal);
		const outcome = applyReceipt(proposal, receipt);
		if (!outcome.accepted || !outcome.changed) return outcome.accepted ? success(state) : outcome;
		proposal.sequence = receipt.sequence;
		const frozenReceipt = deepFreeze(receipt);
		options.appendReceipt(frozenReceipt);
		state = proposal;
		publish();
		return success(state);
	}

	function dispatch(input) {
		const normalized = normalizeDispatch(input);
		if (!normalized) return reject("invalid_action");
		const generation = normalized.action === "plan_open" ? state.generation + 1 : state.generation;
		if (!Number.isSafeInteger(generation) || generation < 1) return reject("limit_reached");
		const planId = normalized.action === "plan_open" ? createPlanId(generation) : normalized.planId;
		if (!isBoundedId(planId)) throw new Error("Execution registry plan ID factory returned an invalid ID.");
		return commit({
			schemaVersion: 1,
			sequence: state.sequence + 1,
			generation,
			planId,
			action: normalized.action,
			payload: normalized.payload,
		});
	}

	function replay(entries) {
		if (!Array.isArray(entries)) {
			state = unavailableState(state.generation, state.sequence);
			publish();
			return reject("invalid_record");
		}
		let candidate = createEmptyState();
		const seen = new Map();
		let failedGeneration;
		let lastAcceptedSequence = 0;
		for (const receipt of entries) {
			const generation = isPlainObject(receipt) ? receipt.generation : undefined;
			if (failedGeneration !== undefined) {
				if (!validateReceiptEnvelope(receipt)) continue;
				if (
					receipt.action !== "plan_open" ||
					receipt.generation !== failedGeneration + 1 ||
					receipt.sequence !== lastAcceptedSequence + 1
				) {
					continue;
				}
				const canonical = canonicalize(receipt);
				if (canonical === undefined) continue;
				const recovery = unavailableState(failedGeneration, lastAcceptedSequence);
				const outcome = applyReceipt(recovery, receipt);
				if (!outcome.accepted || !outcome.changed) continue;
				recovery.sequence = receipt.sequence;
				candidate = recovery;
				lastAcceptedSequence = receipt.sequence;
				failedGeneration = undefined;
				seen.set(receipt.sequence, canonical);
				continue;
			}
			if (!validateReceiptEnvelope(receipt)) {
				failedGeneration = damagedGeneration(candidate, generation);
				continue;
			}
			const canonical = canonicalize(receipt);
			if (canonical === undefined) {
				failedGeneration = damagedGeneration(candidate, receipt.generation);
				continue;
			}
			if (seen.has(receipt.sequence)) {
				if (seen.get(receipt.sequence) !== canonical) {
					failedGeneration = damagedGeneration(candidate, receipt.generation);
				}
				continue;
			}
			if (receipt.sequence !== candidate.sequence + 1) {
				failedGeneration = damagedGeneration(candidate, receipt.generation);
				continue;
			}
			const proposal = cloneState(candidate);
			const outcome = applyReceipt(proposal, receipt);
			if (!outcome.accepted || !outcome.changed) {
				failedGeneration = damagedGeneration(candidate, receipt.generation);
				continue;
			}
			proposal.sequence = receipt.sequence;
			candidate = proposal;
			lastAcceptedSequence = receipt.sequence;
			seen.set(receipt.sequence, canonical);
		}
		state = failedGeneration === undefined ? candidate : unavailableState(failedGeneration, lastAcceptedSequence);
		publish();
		return failedGeneration === undefined ? { accepted: true } : reject("invalid_record");
	}

	function recordToolStart(event) {
		if (!hasExactKeys(event, ["toolCallId", "toolCategory", "commandCategory"])) return false;
		if (
			!isBoundedId(event.toolCallId) ||
			!TOOL_CATEGORIES.has(event.toolCategory) ||
			!COMMAND_CATEGORIES.has(event.commandCategory)
		) {
			return false;
		}
		const snapshot = snapshotState(state);
		if (snapshot.availability !== "available" || snapshot.plan.state !== "sealed" || !snapshot.plan.active)
			return false;
		if (state.inFlight.has(event.toolCallId)) return false;
		state.inFlight.set(event.toolCallId, {
			taskId: snapshot.plan.active.id,
			category: event.toolCategory === "command" ? event.commandCategory : event.toolCategory,
		});
		return true;
	}

	function recordToolEnd(event) {
		if (!hasExactKeys(event, ["toolCallId", "outcome"]) || !isBoundedId(event.toolCallId)) return false;
		if (!new Set(["success", "failure"]).has(event.outcome)) return false;
		const binding = state.inFlight.get(event.toolCallId);
		if (!binding) return false;
		const result = commit(
			{
				schemaVersion: 1,
				sequence: state.sequence + 1,
				generation: state.generation,
				planId: state.plan.id,
				action: "tool_observed",
				payload: {
					taskId: binding.taskId,
					toolCallId: event.toolCallId,
					category: binding.category,
					outcome: event.outcome,
				},
			},
			(proposal) => proposal.inFlight.delete(event.toolCallId),
		);
		return result.accepted;
	}

	function closeInFlight() {
		for (const toolCallId of [...state.inFlight.keys()]) {
			try {
				if (!recordToolEnd({ toolCallId, outcome: "failure" })) return false;
			} catch {
				return false;
			}
		}
		return true;
	}

	function recordVerifiedEvidence(receipt) {
		if (
			!hasExactKeys(receipt, ["source", "generation", "planId", "taskId", "testCaseId", "outcome"]) &&
			!hasExactKeys(receipt, ["source", "generation", "planId", "taskId", "testCaseId", "outcome", "category"])
		) {
			return reject("unverified_receipt");
		}
		if (
			!isBoundedId(receipt.source) ||
			!Number.isSafeInteger(receipt.generation) ||
			receipt.generation !== state.generation ||
			receipt.planId !== state.plan?.id ||
			!isBoundedId(receipt.taskId) ||
			!state.plan?.tasks.has(receipt.taskId) ||
			!isTestCaseId(receipt.testCaseId) ||
			!VERIFIED_OUTCOMES.has(receipt.outcome) ||
			(receipt.category !== undefined && !VERIFIED_CATEGORIES.has(receipt.category))
		) {
			return reject("unverified_receipt");
		}
		let verified = false;
		try {
			verified = verifyReceipt(deepFreeze({ ...receipt })) === true;
		} catch {}
		if (!verified) return reject("unverified_receipt");
		return commit({
			schemaVersion: 1,
			sequence: state.sequence + 1,
			generation: state.generation,
			planId: state.plan.id,
			action: "evidence_verified",
			payload: {
				source: receipt.source,
				taskId: receipt.taskId,
				testCaseId: receipt.testCaseId,
				outcome: receipt.outcome,
				...(receipt.category ? { category: receipt.category } : {}),
			},
		});
	}

	const consumer = deepFreeze({
		snapshot: () => snapshotState(state),
		hasTask(planId, taskId, generation) {
			return (
				state.availability === "available" &&
				state.generation === generation &&
				state.plan.id === planId &&
				state.plan.tasks.has(taskId)
			);
		},
		subscribe(listener) {
			if (typeof listener !== "function") throw new TypeError("Execution registry subscriber must be a function.");
			subscribers.add(listener);
			return deepFreeze({ dispose: () => subscribers.delete(listener) });
		},
	});

	return deepFreeze({
		...consumer,
		consumer,
		dispatch,
		replay,
		recordToolStart,
		recordToolEnd,
		closeInFlight,
		recordVerifiedEvidence,
		clearInFlight() {
			state.inFlight.clear();
		},
	});
}
