import { LANGUAGE_ZH, textFor } from "./language-catalog.js";

const TURN_USAGE_FIELDS = ["input", "output", "cacheRead", "cacheWrite"];

function normalizeObservedUsage(value) {
	if (!value || typeof value !== "object") return undefined;
	const usage = {};
	for (const field of TURN_USAGE_FIELDS) {
		const count = value[field];
		if (Number.isSafeInteger(count) && count >= 0) usage[field] = count;
	}
	return Object.keys(usage).length > 0 ? usage : undefined;
}

function addObservedUsage(target, source, invalidFields) {
	if (!source) return;
	for (const field of TURN_USAGE_FIELDS) {
		if (invalidFields.has(field) || source[field] === undefined) continue;
		const total = (target[field] ?? 0) + source[field];
		if (!Number.isSafeInteger(total)) {
			delete target[field];
			invalidFields.add(field);
		} else {
			target[field] = total;
		}
	}
}

function usageSignature(usage) {
	return TURN_USAGE_FIELDS.map((field) => `${field}:${usage?.[field] ?? "-"}`).join("|");
}

export function createTurnUsage() {
	let committed = {};
	let invalidFields = new Set();
	let current;

	function snapshot() {
		const usage = { ...committed };
		addObservedUsage(usage, current, new Set(invalidFields));
		return Object.keys(usage).length > 0 ? Object.freeze(usage) : undefined;
	}

	function changedAfter(update) {
		const before = usageSignature(snapshot());
		update();
		return before !== usageSignature(snapshot());
	}

	return Object.freeze({
		update(value) {
			const usage = normalizeObservedUsage(value);
			if (!usage) return false;
			return changedAfter(() => {
				current = usage;
			});
		},
		commit(role, value) {
			if (role !== "assistant" && role !== "toolResult") return false;
			return changedAfter(() => {
				const usage = normalizeObservedUsage(value) ?? (role === "assistant" ? current : undefined);
				addObservedUsage(committed, usage, invalidFields);
				if (role === "assistant") current = undefined;
			});
		},
		override(value) {
			const usage = normalizeObservedUsage(value);
			if (!usage) return false;
			return changedAfter(() => {
				committed = usage;
				invalidFields = new Set();
				current = undefined;
			});
		},
		snapshot,
	});
}

export function createTurnExecution() {
	const inFlightTools = new Map();
	const startedToolIds = new Set();
	const endedToolIds = new Set();
	let sequence = 0;
	let toolCalls = 0;
	let toolFailures = 0;
	let recoverPending = false;
	let replyActive = false;

	function validToolCallId(value) {
		return typeof value === "string" && value.length > 0;
	}

	function selectedStage() {
		if (inFlightTools.size > 0) {
			let latest;
			for (const tool of inFlightTools.values()) {
				if (!latest || tool.sequence > latest.sequence) latest = tool;
			}
			return latest?.stage ?? "think";
		}
		if (recoverPending) return "recover";
		if (replyActive) return "reply";
		return "think";
	}

	return Object.freeze({
		start(toolCallId, toolName) {
			if (!validToolCallId(toolCallId) || startedToolIds.has(toolCallId) || endedToolIds.has(toolCallId))
				return false;
			startedToolIds.add(toolCallId);
			sequence += 1;
			inFlightTools.set(toolCallId, { sequence, stage: stageForTool(toolName), toolName });
			if (toolCalls < Number.MAX_SAFE_INTEGER) toolCalls += 1;
			replyActive = false;
			return true;
		},
		end(toolCallId, isError) {
			if (!validToolCallId(toolCallId)) return undefined;
			const tool = inFlightTools.get(toolCallId);
			if (!tool || endedToolIds.has(toolCallId)) return undefined;
			inFlightTools.delete(toolCallId);
			endedToolIds.add(toolCallId);
			if (isError) {
				if (toolFailures < Number.MAX_SAFE_INTEGER) toolFailures += 1;
				recoverPending = true;
			}
			return tool;
		},
		observeReply() {
			replyActive = true;
			if (inFlightTools.size === 0) recoverPending = false;
		},
		selectedStage,
		snapshot() {
			return Object.freeze({
				inFlightCount: inFlightTools.size,
				selectedStage: selectedStage(),
				toolCalls,
				toolFailures,
			});
		},
	});
}

function isSafeCount(value, maximum = Number.MAX_SAFE_INTEGER) {
	return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

export function readExecutionFacts(executionRegistry) {
	if (!executionRegistry?.snapshot) return undefined;
	try {
		const snapshot = executionRegistry.snapshot();
		if (snapshot?.availability === "empty") return undefined;
		if (snapshot?.availability === "unavailable") return { availability: "unavailable" };
		const plan = snapshot?.availability === "available" ? snapshot.plan : undefined;
		if (plan?.state === "drafting") return undefined;
		if (!["sealed", "terminal"].includes(plan?.state)) return { availability: "unavailable" };
		if (!isSafeCount(plan.total, 64) || plan.total < 1) return { availability: "unavailable" };
		const counts = plan.counts;
		if (
			!isSafeCount(counts?.completed, plan.total) ||
			!isSafeCount(counts?.blocked, plan.total) ||
			!isSafeCount(counts?.cancelled, plan.total) ||
			!isSafeCount(counts?.verifiedEvidence, 128) ||
			counts.completed + counts.blocked + counts.cancelled > plan.total
		) {
			return { availability: "unavailable" };
		}
		const active =
			plan.state === "sealed" && isSafeCount(plan.active?.ordinal, plan.total) && plan.active.ordinal >= 1
				? { ordinal: plan.active.ordinal }
				: undefined;
		return {
			availability: "available",
			total: plan.total,
			active,
			completed: counts.completed,
			blocked: counts.blocked,
			verified: counts.verifiedEvidence,
		};
	} catch {
		return undefined;
	}
}

export function createProgressState(language = LANGUAGE_ZH) {
	const text = textFor(language);
	return {
		goal: text.defaultGoal,
		language,
		stage: text.stageConfirm,
		stageId: "goal",
		confirmed: [],
		judgements: [],
		nextSteps: [...text.defaultNext],
		safeguards: [...text.defaultSafeguards],
		activities: [],
		tools: { inspected: 0, edited: 0, commands: 0 },
		visible: false,
	};
}

export function pushUnique(list, value, limit = 3) {
	if (!value || list.includes(value)) return;
	list.push(value);
	if (list.length > limit) list.shift();
}

export function summarizeGoal(prompt, language = LANGUAGE_ZH) {
	const clean = String(prompt ?? "")
		.replace(/[\r\n\t]/g, " ")
		.replace(/(展开细节|查看细节|显示细节|show details|details)[，,；;\s]*/gi, "")
		.replace(/ +/g, " ")
		.trim();
	if (!clean) return textFor(language).defaultGoal;
	return clean.length > 28 ? `${clean.slice(0, 27)}…` : clean;
}

export function getActivitySummary(state) {
	return state.activities.at(-1) ?? textFor(state.language).fallbackActivity;
}

function getToolTarget(args) {
	if (!args || typeof args !== "object") return undefined;
	return args.path ?? args.file_path ?? args.command;
}

function describeCommand(command, language = LANGUAGE_ZH) {
	const text = String(command ?? "").trim();
	const copy = textFor(language);
	const purpose = copy.commandPurposes.find(([pattern]) => pattern.test(text))?.[1] ?? copy.unknownCommandPurpose;
	return { label: text.split(/\s+/).slice(0, 4).join(" "), purpose };
}

function describeToolActivity(toolName, args, isError, language = LANGUAGE_ZH) {
	const target = getToolTarget(args);
	const copy = textFor(language);
	if (toolName === "read") return copy.readActivity(target);
	if (toolName === "edit") return copy.editActivity(target, isError);
	if (toolName === "write") return copy.writeActivity(target, isError);
	if (toolName === "bash" || toolName === "powershell")
		return copy.commandActivity(describeCommand(args?.command, language));
	return copy.toolActivity(toolName);
}

function stageForTool(toolName) {
	if (["read", "grep", "find", "ls"].includes(toolName)) return "inspect";
	if (["edit", "write"].includes(toolName)) return "modify";
	if (["bash", "powershell"].includes(toolName)) return "command";
	return "other";
}

export function setProgressStage(state, stageId) {
	state.stageId = stageId;
	state.stage = textFor(state.language).stageLabels[stageId] ?? textFor(state.language).stageLabels.other;
}

export function updateProgressFromToolStart(state, toolName) {
	const copy = textFor(state.language);
	if (["read", "grep", "find", "ls"].includes(toolName)) {
		pushUnique(state.nextSteps, copy.nextEvidence);
	} else if (["edit", "write"].includes(toolName)) {
		pushUnique(state.judgements, copy.judgementSmallChange);
		pushUnique(state.nextSteps, copy.nextVerify);
	} else if (["bash", "powershell"].includes(toolName)) {
		pushUnique(state.nextSteps, copy.nextCommand);
	}
}

export function updateProgressFromToolEnd(state, toolName, args, isError) {
	const copy = textFor(state.language);
	pushUnique(state.activities, describeToolActivity(toolName, args, isError, state.language), 4);
	if (["read", "grep", "find", "ls"].includes(toolName)) {
		state.tools.inspected += 1;
		pushUnique(state.confirmed, copy.confirmedRead);
	} else if (["edit", "write"].includes(toolName)) {
		state.tools.edited += 1;
		pushUnique(state.confirmed, isError ? copy.confirmedEditError : copy.confirmedEdit);
	} else if (["bash", "powershell"].includes(toolName)) {
		state.tools.commands += 1;
		pushUnique(state.confirmed, isError ? copy.confirmedCommandError : copy.confirmedCommand);
	}
	if (isError) pushUnique(state.judgements, copy.judgementRecover);
}
