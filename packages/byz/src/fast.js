import { getActiveByzOptionIndexes } from "./workflow-switch.js";

const SESSION_OPTIONS = new Set(["--continue", "-c", "--resume", "-r", "--session", "--session-id", "--fork"]);
const THINKING_SUFFIX_PATTERN = /:(off|minimal|low|medium|high|xhigh|max)$/;
const FAST_COMMAND_USAGE = "Usage: /fast [on|off|status]";

function getOptionArgs(args) {
	const terminatorIndex = args.indexOf("--");
	return args.slice(0, terminatorIndex === -1 ? args.length : terminatorIndex);
}

function findOptionValue(args, option) {
	let value;
	for (let index = 0; index < args.length; index++) {
		if (args[index] === option) value = args[index + 1];
	}
	return value;
}

export function prepareFastRuntimeArgs(args, env = process.env) {
	const forwardedArgs = [];
	const activeFastOptions = getActiveByzOptionIndexes(args, "fast");
	let enabled = false;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--") {
			forwardedArgs.push(...args.slice(index));
			break;
		}
		if (arg === "--fast" && activeFastOptions.has(index)) {
			if (enabled) throw new Error("--fast may only be specified once.");
			enabled = true;
			continue;
		}
		if (arg.startsWith("--fast=") && activeFastOptions.has(index)) {
			throw new Error("--fast does not accept a value.");
		}
		forwardedArgs.push(arg);
	}

	if (!enabled) {
		return { args: forwardedArgs, commandArgs: forwardedArgs, enabled: false };
	}

	const optionArgs = getOptionArgs(forwardedArgs);
	const hasModelOption = optionArgs.includes("--model");
	const hasThinkingOption = optionArgs.includes("--thinking");
	const resumesSession = optionArgs.some((arg) => SESSION_OPTIONS.has(arg));
	const configuredModel = env.BYZ_FAST_MODEL?.trim();
	const explicitModel = findOptionValue(optionArgs, "--model");
	const modelThinking = explicitModel?.match(THINKING_SUFFIX_PATTERN)?.[1];
	const presetArgs = [];
	if (!hasModelOption && !resumesSession && configuredModel) {
		presetArgs.push("--model", configuredModel);
	}
	if (!hasThinkingOption && !modelThinking) {
		presetArgs.push("--thinking", "low");
	}

	const explicitThinking = findOptionValue(optionArgs, "--thinking");
	return {
		args: [...presetArgs, ...forwardedArgs],
		commandArgs: forwardedArgs,
		enabled: true,
		model: explicitModel ?? (resumesSession ? "session" : configuredModel || "default"),
		thinking: explicitThinking ?? modelThinking ?? "low",
		useConfiguredModel: !hasModelOption && !resumesSession,
		useLowThinking: !hasThinkingOption && !modelThinking,
	};
}

export function selectFastRuntimeArgs(fastRuntime, { isInteractive, loadWorkflow }) {
	if (isInteractive) return fastRuntime.commandArgs;
	return loadWorkflow ? fastRuntime.args : fastRuntime.commandArgs;
}

function parseFastModelReference(value) {
	const separatorIndex = value.indexOf("/");
	if (separatorIndex <= 0 || separatorIndex === value.length - 1) return undefined;
	return {
		provider: value.slice(0, separatorIndex),
		modelId: value.slice(separatorIndex + 1),
	};
}

function formatModel(model) {
	return model ? `${model.provider}/${model.id}` : "none";
}

function modelsMatch(left, right) {
	return left?.provider === right?.provider && left?.id === right?.id;
}

export function createFastSwitchExtension({
	env = process.env,
	initiallyEnabled = false,
	initialUseConfiguredModel = true,
	initialUseLowThinking = true,
} = {}) {
	return function fastSwitchExtension(pi) {
		let active = false;
		let snapshot;
		let internalTransition = false;
		let currentThinkingTransition;
		const ignoredThinkingTransitions = [];

		function notifyStatus(ctx) {
			ctx.ui.notify(
				`Fast: ${active ? "on" : "off"}; model=${formatModel(ctx.model)}; thinking=${pi.getThinkingLevel()}`,
				"info",
			);
		}

		function exitForExplicitSelection() {
			if (!active || internalTransition) return;
			active = false;
			snapshot = undefined;
		}

		function handleThinkingSelection(event) {
			if (
				currentThinkingTransition &&
				event.previousLevel === currentThinkingTransition.previousLevel &&
				event.level === pi.getThinkingLevel()
			) {
				currentThinkingTransition.consumed = true;
				return;
			}
			const ignoredIndex = ignoredThinkingTransitions.findIndex(
				(transition) => transition.previousLevel === event.previousLevel && transition.level === event.level,
			);
			if (ignoredIndex !== -1) {
				ignoredThinkingTransitions.splice(ignoredIndex, 1);
				return;
			}
			exitForExplicitSelection();
		}

		function beginThinkingTransition() {
			const transition = {
				previousLevel: pi.getThinkingLevel(),
				level: pi.getThinkingLevel(),
				consumed: false,
			};
			currentThinkingTransition = transition;
			return transition;
		}

		function finishThinkingTransition(transition) {
			transition.level = pi.getThinkingLevel();
			currentThinkingTransition = undefined;
			if (!transition.consumed && transition.level !== transition.previousLevel) {
				ignoredThinkingTransitions.push(transition);
			}
		}

		function setThinkingInternally(level) {
			if (pi.getThinkingLevel() === level) return;
			const transition = beginThinkingTransition();
			try {
				pi.setThinkingLevel(level);
			} finally {
				finishThinkingTransition(transition);
			}
		}

		async function setModelInternally(model) {
			const transition = beginThinkingTransition();
			try {
				return await pi.setModel(model);
			} finally {
				finishThinkingTransition(transition);
			}
		}

		async function enable(ctx, { useConfiguredModel = true, useLowThinking = true } = {}) {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Fast cannot change while the agent is busy.", "warning");
				return;
			}
			if (active) {
				notifyStatus(ctx);
				return;
			}

			const configuredModel = useConfiguredModel ? env.BYZ_FAST_MODEL?.trim() : undefined;
			let targetModel;
			if (configuredModel) {
				const reference = parseFastModelReference(configuredModel);
				if (!reference) {
					ctx.ui.notify(`Invalid BYZ_FAST_MODEL "${configuredModel}". Expected provider/model.`, "error");
					return;
				}
				targetModel = ctx.modelRegistry.find(reference.provider, reference.modelId);
				if (!targetModel) {
					ctx.ui.notify(`Fast model "${configuredModel}" was not found.`, "error");
					return;
				}
				if (!ctx.modelRegistry.hasConfiguredAuth(targetModel)) {
					ctx.ui.notify(`Fast model "${configuredModel}" has no configured authentication.`, "error");
					return;
				}
				if (!ctx.model) {
					ctx.ui.notify("Fast cannot preserve the current model because no model is selected.", "error");
					return;
				}
			}

			const nextSnapshot = {
				model: ctx.model,
				thinking: pi.getThinkingLevel(),
			};
			internalTransition = true;
			try {
				if (targetModel && !modelsMatch(ctx.model, targetModel)) {
					const changed = await setModelInternally(targetModel);
					if (!changed) {
						ctx.ui.notify(`Fast model "${configuredModel}" has no configured authentication.`, "error");
						return;
					}
				}
				setThinkingInternally(useLowThinking ? "low" : nextSnapshot.thinking);
				snapshot = nextSnapshot;
				active = true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Fast could not be enabled: ${message}`, "error");
				return;
			} finally {
				internalTransition = false;
			}
			notifyStatus(ctx);
		}

		async function disable(ctx) {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Fast cannot change while the agent is busy.", "warning");
				return;
			}
			if (!active || !snapshot) {
				notifyStatus(ctx);
				return;
			}

			internalTransition = true;
			try {
				if (snapshot.model && !modelsMatch(ctx.model, snapshot.model)) {
					const changed = await setModelInternally(snapshot.model);
					if (!changed) {
						ctx.ui.notify(
							`Original model "${formatModel(snapshot.model)}" has no configured authentication.`,
							"error",
						);
						return;
					}
				}
				setThinkingInternally(snapshot.thinking);
				active = false;
				snapshot = undefined;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Fast could not be disabled: ${message}`, "error");
				return;
			} finally {
				internalTransition = false;
			}
			notifyStatus(ctx);
		}

		pi.registerCommand("fast", {
			description: "Switch Fast mode for the current session",
			handler: async (args, ctx) => {
				const action = args.trim().toLowerCase() || "status";
				if (action === "status") {
					notifyStatus(ctx);
					return;
				}
				if (action === "on") {
					await enable(ctx);
					return;
				}
				if (action === "off") {
					await disable(ctx);
					return;
				}
				ctx.ui.notify(FAST_COMMAND_USAGE, "warning");
			},
		});

		pi.on("model_select", exitForExplicitSelection);
		pi.on("thinking_level_select", handleThinkingSelection);
		if (initiallyEnabled) {
			pi.on("session_start", async (_event, ctx) => {
				await enable(ctx, {
					useConfiguredModel: initialUseConfiguredModel,
					useLowThinking: initialUseLowThinking,
				});
			});
		}
	};
}
