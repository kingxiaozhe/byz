const FAST_COMMAND_USAGE = "Usage: /fast [on|off|status]";

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

export function createFastSessionController({
	env = process.env,
	initiallyEnabled = false,
	initialUseConfiguredModel = true,
	initialUseLowThinking = true,
} = {}) {
	let active = false;
	let snapshot;
	let internalTransition = false;
	let currentThinkingTransition;
	let pi;
	const ignoredThinkingTransitions = [];
	const activeListeners = new Set();
	const explicitSelectionListeners = new Set();

	function notifyStatus(ctx) {
		ctx.ui.notify(
			`Fast: ${active ? "on" : "off"}; model=${formatModel(ctx.model)}; thinking=${pi.getThinkingLevel()}`,
			"info",
		);
	}

	async function emitListeners(listeners, event, ctx) {
		for (const listener of listeners) await listener(event, ctx);
	}

	async function exitForExplicitSelection(event, ctx) {
		if (internalTransition) return;
		if (active) {
			active = false;
			snapshot = undefined;
			await emitListeners(activeListeners, false, ctx);
		}
		await emitListeners(explicitSelectionListeners, event, ctx);
	}

	async function handleThinkingSelection(event, ctx) {
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
		await exitForExplicitSelection(event, ctx);
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

	function resolveTarget(
		ctx,
		{ requireAuth = false, requireModel = false, useConfiguredModel = true, useLowThinking = true } = {},
	) {
		const configuredModel = useConfiguredModel ? env.BYZ_FAST_MODEL?.trim() : undefined;
		let model = ctx.model;
		if (configuredModel) {
			const reference = parseFastModelReference(configuredModel);
			if (!reference) {
				ctx.ui.notify(`Invalid BYZ_FAST_MODEL "${configuredModel}". Expected provider/model.`, "error");
				return undefined;
			}
			model = ctx.modelRegistry.find(reference.provider, reference.modelId);
			if (!model) {
				ctx.ui.notify(`Fast model "${configuredModel}" was not found.`, "error");
				return undefined;
			}
			if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
				ctx.ui.notify(`Fast model "${configuredModel}" has no configured authentication.`, "error");
				return undefined;
			}
			if (!ctx.model) {
				ctx.ui.notify("Fast cannot preserve the current model because no model is selected.", "error");
				return undefined;
			}
		}
		if (!model && requireModel) {
			ctx.ui.notify("Fast cannot preserve the current model because no model is selected.", "error");
			return undefined;
		}
		if (model && requireAuth && !ctx.modelRegistry.hasConfiguredAuth(model)) {
			ctx.ui.notify(`Fast model "${formatModel(model)}" has no configured authentication.`, "error");
			return undefined;
		}
		return {
			configuredModel,
			model,
			thinking: useLowThinking ? "low" : pi.getThinkingLevel(),
		};
	}

	async function applyTarget(ctx, target) {
		internalTransition = true;
		try {
			if (target.model && !modelsMatch(ctx.model, target.model)) {
				const changed = await setModelInternally(target.model);
				if (!changed) {
					ctx.ui.notify(`Fast model "${formatModel(target.model)}" has no configured authentication.`, "error");
					return false;
				}
			}
			setThinkingInternally(target.thinking);
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Fast target could not be applied: ${message}`, "error");
			return false;
		} finally {
			internalTransition = false;
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

		const target = resolveTarget(ctx, { useConfiguredModel, useLowThinking });
		if (!target) return;
		const nextSnapshot = {
			model: ctx.model,
			thinking: pi.getThinkingLevel(),
		};
		if (!(await applyTarget(ctx, target))) return;
		snapshot = nextSnapshot;
		active = true;
		await emitListeners(activeListeners, true, ctx);
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

		const originalTarget = { model: snapshot.model, thinking: snapshot.thinking };
		if (!(await applyTarget(ctx, originalTarget))) return;
		active = false;
		snapshot = undefined;
		await emitListeners(activeListeners, false, ctx);
		notifyStatus(ctx);
	}

	function extension(extensionApi) {
		pi = extensionApi;

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
	}

	return {
		applyTarget,
		extension,
		formatTarget(target) {
			return formatModel(target.model);
		},
		getThinkingLevel() {
			return pi.getThinkingLevel();
		},
		isActive() {
			return active;
		},
		onActiveChange(listener) {
			activeListeners.add(listener);
			return () => activeListeners.delete(listener);
		},
		onExplicitSelection(listener) {
			explicitSelectionListeners.add(listener);
			return () => explicitSelectionListeners.delete(listener);
		},
		resolveTarget,
	};
}

export function createFastSwitchExtension(options) {
	return createFastSessionController(options).extension;
}
