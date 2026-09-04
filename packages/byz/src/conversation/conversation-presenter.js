import { EXECUTION_TEXT, LANGUAGE_EN, textFor } from "./language-catalog.js";
import { getActivitySummary } from "./progress-projector.js";
import { formatElapsed } from "./turn-timing.js";

const MODEL_ACTIVE_STAGES = new Set(["think", "recover", "reply"]);

function formatTokens(count) {
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

const TURN_USAGE_FIELDS = ["input", "output", "cacheRead", "cacheWrite"];

function formatTurnUsageHeadline(usage, language) {
	const label = language === LANGUAGE_EN ? "Tokens" : "Token";
	if (usage?.input === undefined || usage.output === undefined) return `${label} —`;
	const total = usage.input + usage.output;
	return Number.isSafeInteger(total) ? `${label} ${formatTokens(total)}` : `${label} —`;
}

function formatTurnUsageSummary(usage, language) {
	if (!usage) return language === LANGUAGE_EN ? "Tokens —" : "Token —";
	const labels =
		language === LANGUAGE_EN
			? { input: "input", output: "output", cacheRead: "cache read", cacheWrite: "cache write" }
			: { input: "输入", output: "输出", cacheRead: "缓存读取", cacheWrite: "缓存写入" };
	const parts = TURN_USAGE_FIELDS.flatMap((field) =>
		usage[field] === undefined ? [] : [`${labels[field]} ${formatTokens(usage[field])}`],
	);
	if (parts.length === 0) return language === LANGUAGE_EN ? "Tokens —" : "Token —";
	return `${language === LANGUAGE_EN ? "Tokens: " : "Token："}${parts.join(language === LANGUAGE_EN ? "; " : "；")}`;
}

function executionFactParts(facts, language, includeStep = true) {
	if (facts?.availability !== "available") return [];
	const copy = EXECUTION_TEXT[language];
	const parts = [];
	if (includeStep && facts.active) parts.push(copy.step(facts.active.ordinal, facts.total));
	parts.push(copy.completed(facts.completed, facts.total));
	if (facts.blocked > 0) parts.push(copy.blocked(facts.blocked));
	if (facts.verified > 0) parts.push(copy.verified(facts.verified));
	return parts;
}

function timingValues(state, snapshot) {
	const copy = textFor(state.language);
	const language = state.language;
	return {
		active: formatElapsed(snapshot.activeMs, language),
		stage: copy.stageLabels[snapshot.currentStage] ?? copy.stageLabels.other,
		shortStage: copy.stageShortLabels[snapshot.currentStage] ?? copy.stageShortLabels.other,
		stageElapsed: formatElapsed(snapshot.currentStageMs, language),
		waiting: formatElapsed(snapshot.confirmationWaitingMs ?? snapshot.waitingMs, language),
	};
}

function joinCompactStatus(requiredParts, optionalPart) {
	const withOptional = optionalPart
		? [...requiredParts.slice(0, -2), optionalPart, ...requiredParts.slice(-2)]
		: requiredParts;
	const candidate = withOptional.join(" · ");
	return candidate.length <= 80 ? candidate : requiredParts.join(" · ");
}

export function renderProgressCard(state, snapshot, usage, execution, executionFacts, options = {}) {
	const copy = textFor(state.language);
	const executionCopy = EXECUTION_TEXT[state.language];
	if (options.compact) {
		const stage =
			snapshot.waitingReason === "pause" ? "paused" : snapshot.waiting ? "waiting" : execution.selectedStage;
		const parts = [executionCopy.status[stage] ?? executionCopy.status.think];
		if (executionFacts?.availability === "available" && executionFacts.active) {
			parts.push(executionCopy.step(executionFacts.active.ordinal, executionFacts.total));
		}
		parts.push(formatElapsed(snapshot.totalMs, state.language), formatTurnUsageHeadline(usage, state.language));
		return joinCompactStatus(
			parts,
			stage !== "paused" && execution.inFlightCount > 0
				? executionCopy.runningTools(execution.inFlightCount)
				: undefined,
		);
	}
	const lines = [...copy.detailLines({ state, activity: getActivitySummary(state) })];
	if (executionFacts?.availability === "available") {
		lines.push(executionCopy.planDetails(executionFactParts(executionFacts, state.language)));
	} else if (executionFacts?.availability === "unavailable") {
		lines.push(executionCopy.planUnavailable);
	}
	const timingLines = copy.timingLines(timingValues(state, snapshot));
	if ((snapshot.pauseWaitingMs ?? 0) > 0) {
		timingLines.push(executionCopy.pauseSummary(formatElapsed(snapshot.pauseWaitingMs, state.language)));
	}
	return [...lines, ...timingLines, formatTurnUsageSummary(usage, state.language)].join("\n");
}

export function renderTimingSummary(state, snapshot, usage, execution, executionFacts) {
	const language = state.language;
	const executionCopy = EXECUTION_TEXT[language];
	const modelActiveMs = snapshot.stages.reduce(
		(sum, entry) => (MODEL_ACTIVE_STAGES.has(entry.stage) ? sum + entry.milliseconds : sum),
		0,
	);
	const firstLine = [
		executionCopy.completion,
		formatElapsed(snapshot.totalMs, language),
		formatTurnUsageHeadline(usage, language),
	].join(" · ");
	const secondLine = [executionCopy.modelActive(formatElapsed(modelActiveMs, language))];
	if (execution.toolCalls > 0) secondLine.push(executionCopy.toolSummary(execution.toolCalls, execution.toolFailures));
	if ((snapshot.confirmationWaitingMs ?? snapshot.waitingMs) > 0) {
		secondLine.push(
			executionCopy.waitingSummary(formatElapsed(snapshot.confirmationWaitingMs ?? snapshot.waitingMs, language)),
		);
	}
	if ((snapshot.pauseWaitingMs ?? 0) > 0) {
		secondLine.push(executionCopy.pauseSummary(formatElapsed(snapshot.pauseWaitingMs, language)));
	}
	const lines = [firstLine, secondLine.join(" · ")];
	const facts = executionFactParts(executionFacts, language, false);
	if (facts.length > 0) lines.push(facts.join(" · "));
	return lines.join("\n");
}
