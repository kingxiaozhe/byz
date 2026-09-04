import { createConfirmationPresenter } from "./confirmation-presenter.js";
import { createConversationPreferencesRepository } from "./conversation-preferences.js";
import { renderProgressCard, renderTimingSummary } from "./conversation-presenter.js";
import { createByzFooter } from "./footer-presenter.js";
import { createInteractionPolicy, parseConversationControl } from "./interaction-policy.js";
import {
	DETAIL_MODE_COMPACT,
	DETAIL_MODE_DETAILS,
	detectLanguage,
	LANGUAGE_AUTO,
	LANGUAGE_EN,
	LANGUAGE_ZH,
	textFor,
	WELCOME,
} from "./language-catalog.js";
import {
	createProgressState,
	createTurnExecution,
	createTurnUsage,
	pushUnique,
	readExecutionFacts,
	setProgressStage,
	summarizeGoal,
	updateProgressFromToolEnd,
	updateProgressFromToolStart,
} from "./progress-projector.js";
import { createRoutingPolicy } from "./routing-policy.js";
import { createTurnTiming } from "./turn-timing.js";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function normalizeThinkingLevel(level) {
	return THINKING_LEVELS.has(level) ? level : "off";
}

export function createConversationController(options = {}) {
	const policy = createInteractionPolicy();
	const routingPolicy = createRoutingPolicy();
	const progressCardDelayMs = options.progressCardDelayMs ?? 2_000;
	const now = options.now ?? (() => performance.now());
	const scheduleInterval = options.setInterval ?? setInterval;
	const cancelInterval = options.clearInterval ?? clearInterval;
	const scheduleTimeout = options.setTimeout ?? setTimeout;
	const cancelTimeout = options.clearTimeout ?? clearTimeout;
	const executionRegistry = options.executionRegistry;
	const pauseController = options.pauseController;
	const preferencesRepository = options.preferencesRepository ?? createConversationPreferencesRepository();
	const initialPreferenceState = preferencesRepository.read();
	if (!["ok", "missing"].includes(initialPreferenceState.diagnostic.state)) {
		options.onPreferenceDiagnostic?.(initialPreferenceState.diagnostic);
	}
	const initialPreferences = initialPreferenceState.preferences;
	let savedDetailMode = initialPreferences.detailMode;
	let savedLanguage = initialPreferences.language;
	let currentLanguage = detectLanguage("", savedLanguage);

	let progressTimer;
	let elapsedTimer;
	let turnGeneration = 0;
	let turnTiming;
	let turnUsage;
	let turnExecution;
	let footerComponent;
	let currentThinkingLevel = "off";
	let progressState = createProgressState(currentLanguage);
	let activeCtx;
	let previousPauseState = pauseController?.snapshot().state;
	executionRegistry?.subscribe?.(() => publishWorking());
	pauseController?.subscribe((snapshot) => {
		if (snapshot.state === "paused" && previousPauseState !== "paused") turnTiming?.pause("pause");
		if (snapshot.state === "running" && ["paused", "resuming"].includes(previousPauseState)) {
			turnTiming?.resume("pause");
		}
		previousPauseState = snapshot.state;
		publishWorking();
	});

	function clearProgressTimer() {
		if (progressTimer !== undefined) cancelTimeout(progressTimer);
		progressTimer = undefined;
	}

	function clearElapsedTimer() {
		if (elapsedTimer !== undefined) cancelInterval(elapsedTimer);
		elapsedTimer = undefined;
	}

	function syncSelectedStage() {
		if (!turnTiming || !turnExecution) return false;
		const stage = turnExecution.selectedStage();
		if (progressState.stageId === stage) return false;
		setProgressStage(progressState, stage);
		turnTiming.transition(stage);
		return true;
	}

	function publishWorking() {
		if (!activeCtx || !turnTiming || !turnExecution || !progressState.visible) return;
		activeCtx.ui.setWorkingMessage?.(
			renderProgressCard(
				progressState,
				turnTiming.snapshot(),
				turnUsage?.snapshot(),
				turnExecution.snapshot(),
				readExecutionFacts(executionRegistry),
				{ compact: !policy.isDetailEnabled() },
			),
		);
	}

	function publishProgress() {
		progressTimer = undefined;
		if (!activeCtx || !turnTiming) return;
		progressState.visible = true;
		publishWorking();
	}

	function finishTurn(options = {}) {
		turnGeneration += 1;
		clearProgressTimer();
		clearElapsedTimer();
		const usage = turnUsage?.snapshot();
		const execution = turnExecution?.snapshot();
		turnUsage = undefined;
		turnExecution = undefined;
		if (!turnTiming || !execution) {
			turnTiming = undefined;
			return;
		}
		const snapshot = turnTiming.finish();
		if (options.notify && activeCtx) {
			activeCtx.ui.notify(
				renderTimingSummary(progressState, snapshot, usage, execution, readExecutionFacts(executionRegistry)),
				"info",
			);
		}
		turnTiming = undefined;
	}

	function onSessionStart(_event, ctx) {
		routingPolicy.reset();
		policy.setDetailEnabled(savedDetailMode === DETAIL_MODE_DETAILS);
		currentThinkingLevel = normalizeThinkingLevel(ctx.thinkingLevel);
		ctx.ui.setTitle?.("BYZ");
		ctx.ui.setMessagePresenter?.((message) => policy.presentAssistantMessage(message));
		ctx.ui.setToolExecutionVisible?.(policy.isDetailEnabled());
		ctx.ui.setFooter?.((tui, theme, footerData) => {
			footerComponent = createByzFooter(ctx, tui, theme, footerData, () => currentThinkingLevel);
			return footerComponent;
		});
		ctx.ui.setConfirmationPresenter?.(
			createConfirmationPresenter({
				beginConfirmation: () => pauseController?.beginConfirmation(),
				endConfirmation: (generation) => pauseController?.endConfirmation(generation),
				getGeneration: () => turnGeneration,
				getTurnTiming: () => turnTiming,
				input: (prompt, title) => ctx.ui.input(prompt, title),
				notify: (message, level) => ctx.ui.notify(message, level),
				publishWorking,
			}),
		);
		if (initialPreferenceState.diagnostic.state === "corrupt") {
			ctx.ui.notify(textFor(currentLanguage).preferencesCorrupt, "warning");
		} else if (initialPreferenceState.diagnostic.state === "unavailable") {
			ctx.ui.notify(textFor(currentLanguage).preferencesUnavailable, "warning");
		}
		ctx.ui.notify(WELCOME, "info");
	}
	function onThinkingLevelSelect(event) {
		currentThinkingLevel = normalizeThinkingLevel(event.level);
		footerComponent?.invalidate();
	}
	function onAgentStart(_event, ctx) {
		if (turnTiming) finishTurn({ notify: true });
		activeCtx = ctx;
		policy.resetProgress();
		progressState.visible = false;
		clearProgressTimer();
		clearElapsedTimer();
		turnGeneration += 1;
		const generation = turnGeneration;
		turnTiming = createTurnTiming({ now });
		turnUsage = createTurnUsage();
		turnExecution = createTurnExecution();
		setProgressStage(progressState, "think");
		turnTiming.start("think");
		elapsedTimer = scheduleInterval(() => {
			if (generation === turnGeneration) publishWorking();
		}, 1_000);
		progressTimer = scheduleTimeout(() => {
			if (generation !== turnGeneration) return;
			publishProgress();
		}, progressCardDelayMs);
	}
	function onToolExecutionStart(event) {
		if (!turnExecution?.start(event.toolCallId, event.toolName)) return;
		updateProgressFromToolStart(progressState, event.toolName);
		syncSelectedStage();
		publishWorking();
	}
	function onToolExecutionEnd(event) {
		const tool = turnExecution?.end(event.toolCallId, event.isError);
		if (!tool) return;
		updateProgressFromToolEnd(progressState, tool.toolName, event.args, event.isError);
		syncSelectedStage();
		publishWorking();
	}
	function onMessageUpdate(event) {
		if (event.message?.role !== "assistant") return;
		const copy = textFor(progressState.language);
		const usageChanged = turnUsage?.update(event.message.usage) ?? false;
		turnExecution?.observeReply();
		const stageChanged = syncSelectedStage();
		pushUnique(progressState.nextSteps, copy.nextResult);
		if (stageChanged || usageChanged) publishWorking();
	}
	function onMessageEnd(event) {
		if (turnUsage?.commit(event.message?.role, event.message?.usage)) publishWorking();
	}
	function onAgentEnd(event) {
		turnUsage?.override(event.usage);
		if (pauseController) return;
		finishTurn({ notify: true });
		activeCtx?.ui.setWorkingMessage?.();
		activeCtx = undefined;
	}
	function onAgentSettled() {
		if (!turnTiming) return;
		finishTurn({ notify: true });
		activeCtx?.ui.setWorkingMessage?.();
		activeCtx = undefined;
	}
	function onSessionShutdown() {
		routingPolicy.reset();
		footerComponent = undefined;
		finishTurn();
		activeCtx?.ui.setWorkingMessage?.();
		activeCtx = undefined;
	}
	async function applyDetailMode(ctx, mode, options = {}) {
		const copy = textFor(currentLanguage);
		if (options.remember) {
			const updated = await preferencesRepository.update({ detailMode: mode });
			savedDetailMode = updated.preferences.detailMode;
		}
		policy.setDetailEnabled(mode === DETAIL_MODE_DETAILS);
		ctx.ui.setToolExecutionVisible?.(policy.isDetailEnabled());
		const scope = options.remember ? copy.detailScopeRemember : copy.detailScopeSession;
		ctx.ui.notify(mode === DETAIL_MODE_DETAILS ? copy.detailsOn(scope) : copy.detailsOff(scope), "info");
	}

	async function handleDetailsCommand(args, ctx) {
		const action = String(args ?? "")
			.trim()
			.toLowerCase();
		if (!action || action === "on") {
			await applyDetailMode(ctx, DETAIL_MODE_DETAILS);
			return;
		}
		if (["off", "compact"].includes(action)) {
			await applyDetailMode(ctx, DETAIL_MODE_COMPACT);
			return;
		}
		if (["remember", "save", "details"].includes(action)) {
			await applyDetailMode(ctx, DETAIL_MODE_DETAILS, { remember: true });
			return;
		}
		if (["remember compact", "save compact", "compact remember"].includes(action)) {
			await applyDetailMode(ctx, DETAIL_MODE_COMPACT, { remember: true });
			return;
		}
		if (action === "status") {
			const current = policy.isDetailEnabled() ? DETAIL_MODE_DETAILS : DETAIL_MODE_COMPACT;
			ctx.ui.notify(textFor(currentLanguage).detailsStatus(current, savedDetailMode), "info");
			return;
		}
		ctx.ui.notify(textFor(currentLanguage).detailsUsage, "warning");
	}

	async function applyLanguage(language, ctx) {
		const updated = await preferencesRepository.update({ language });
		savedLanguage = updated.preferences.language;
		currentLanguage = detectLanguage("", savedLanguage);
		progressState.language = currentLanguage;
		ctx.ui.notify(textFor(currentLanguage).languageSet(language), "info");
	}

	async function handleLanguageCommand(args, ctx) {
		const action = String(args ?? "")
			.trim()
			.toLowerCase();
		if ([LANGUAGE_AUTO, LANGUAGE_ZH, LANGUAGE_EN].includes(action)) {
			await applyLanguage(action, ctx);
			return;
		}
		if (action === "status") {
			ctx.ui.notify(textFor(currentLanguage).languageStatus(currentLanguage, savedLanguage), "info");
			return;
		}
		ctx.ui.notify(textFor(currentLanguage).languageUsage, "warning");
	}

	async function onBeforeAgentStart(event, ctx) {
		currentLanguage = detectLanguage(event.prompt, savedLanguage);
		const copy = textFor(currentLanguage);
		const route = routingPolicy.route(event.prompt);
		progressState = createProgressState(currentLanguage);
		progressState.goal = summarizeGoal(event.prompt, currentLanguage);
		pushUnique(progressState.confirmed, copy.confirmedGoal);
		pushUnique(progressState.judgements, copy.judgementRecover);
		if (route.kind !== "general") pushUnique(progressState.judgements, copy.taskKind(route.kind));
		if (route.preferences.autonomy === "confirm-key-actions") {
			pushUnique(progressState.safeguards, copy.confirmKeyActions);
		}
		if (route.details || parseConversationControl(event.prompt) === "detail") {
			await applyDetailMode(ctx, DETAIL_MODE_DETAILS);
		}
		if (policy.isDetailEnabled()) {
			ctx.ui.notify(copy.routeNotice(route), "info");
		}
		return {
			systemPrompt: `${event.systemPrompt ?? ""}\n\nBYZ collaboration guidance for this turn:\n${route.instructions}`,
		};
	}
	return Object.freeze({
		handleDetailsCommand,
		handleLanguageCommand,
		onAgentEnd,
		onAgentSettled,
		onAgentStart,
		onBeforeAgentStart,
		onMessageEnd,
		onMessageUpdate,
		onSessionShutdown,
		onSessionStart,
		onThinkingLevelSelect,
		onToolExecutionEnd,
		onToolExecutionStart,
	});
}
