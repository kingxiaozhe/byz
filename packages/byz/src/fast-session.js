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

function modelIdentity(model) {
	return model ? Object.freeze({ provider: model.provider, id: model.id }) : undefined;
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
	let currentFastContext;
	let ports;
	const ignoredThinkingTransitions = [];
	const activeListeners = new Set();
	const explicitSelectionListeners = new Set();

	function getModelContext(ctx) {
		if (ctx.modelRegistry) return ctx;
		if (currentFastContext) return currentFastContext;
		ctx.ui.notify("Fast session state is unavailable.", "error");
		return undefined;
	}

	function notifyStatus(ctx) {
		ctx.ui.notify(
			`Fast: ${active ? "on" : "off"}; model=${formatModel(getModelContext(ctx)?.model)}; thinking=${ports.getThinkingLevel()}`,
			"info",
		);
	}

	async function emitListeners(listeners, event, ctx) {
		const listenerContext = Object.freeze({ ui: ctx.ui });
		for (const listener of listeners) await listener(event, listenerContext);
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
			event.level === ports.getThinkingLevel()
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
			previousLevel: ports.getThinkingLevel(),
			level: ports.getThinkingLevel(),
			consumed: false,
		};
		currentThinkingTransition = transition;
		return transition;
	}

	function finishThinkingTransition(transition) {
		transition.level = ports.getThinkingLevel();
		currentThinkingTransition = undefined;
		if (!transition.consumed && transition.level !== transition.previousLevel) {
			ignoredThinkingTransitions.push(transition);
		}
	}

	function setThinkingInternally(level) {
		if (ports.getThinkingLevel() === level) return;
		const transition = beginThinkingTransition();
		try {
			ports.setThinkingLevel(level);
		} finally {
			finishThinkingTransition(transition);
		}
	}

	async function setModelInternally(model) {
		const transition = beginThinkingTransition();
		try {
			return await ports.setModel(model);
		} finally {
			finishThinkingTransition(transition);
		}
	}

	function resolveTarget(
		ctx,
		{ requireAuth = false, requireModel = false, useConfiguredModel = true, useLowThinking = true } = {},
	) {
		const modelContext = getModelContext(ctx);
		if (!modelContext) return undefined;
		const configuredModel = useConfiguredModel ? env.BYZ_FAST_MODEL?.trim() : undefined;
		let modelHandle = modelContext.model;
		if (configuredModel) {
			const reference = parseFastModelReference(configuredModel);
			if (!reference) {
				ctx.ui.notify(`Invalid BYZ_FAST_MODEL "${configuredModel}". Expected provider/model.`, "error");
				return undefined;
			}
			modelHandle = modelContext.modelRegistry.find(reference.provider, reference.modelId);
			if (!modelHandle) {
				ctx.ui.notify(`Fast model "${configuredModel}" was not found.`, "error");
				return undefined;
			}
			if (!modelContext.modelRegistry.hasConfiguredAuth(modelHandle)) {
				ctx.ui.notify(`Fast model "${configuredModel}" has no configured authentication.`, "error");
				return undefined;
			}
			if (!modelContext.model) {
				ctx.ui.notify("Fast cannot preserve the current model because no model is selected.", "error");
				return undefined;
			}
		}
		if (!modelHandle && requireModel) {
			ctx.ui.notify("Fast cannot preserve the current model because no model is selected.", "error");
			return undefined;
		}
		if (modelHandle && requireAuth && !modelContext.modelRegistry.hasConfiguredAuth(modelHandle)) {
			ctx.ui.notify(`Fast model "${formatModel(modelHandle)}" has no configured authentication.`, "error");
			return undefined;
		}
		return {
			configuredModel,
			model: modelIdentity(modelHandle),
			thinking: useLowThinking ? "low" : ports.getThinkingLevel(),
		};
	}

	async function applyTarget(ctx, target) {
		const modelContext = getModelContext(ctx);
		if (!modelContext) return false;
		internalTransition = true;
		try {
			if (target.model && !modelsMatch(modelContext.model, target.model)) {
				const modelHandle = modelContext.modelRegistry.find(target.model.provider, target.model.id);
				if (!modelHandle || !modelContext.modelRegistry.hasConfiguredAuth(modelHandle)) {
					ctx.ui.notify(`Fast model "${formatModel(target.model)}" has no configured authentication.`, "error");
					return false;
				}
				const changed = await setModelInternally(modelHandle);
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
		const modelContext = getModelContext(ctx);
		if (!modelContext) return;
		const nextSnapshot = {
			model: modelIdentity(modelContext.model),
			thinking: ports.getThinkingLevel(),
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
		ports = extensionApi;

		ports.registerCommand("fast", {
			description: "Switch Fast mode for the current session",
			handler: async (args, ctx) => {
				currentFastContext = ctx;
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

		ports.on("model_select", async (event, ctx) => {
			currentFastContext = ctx;
			await exitForExplicitSelection(event, ctx);
		});
		ports.on("thinking_level_select", async (event, ctx) => {
			currentFastContext = ctx;
			await handleThinkingSelection(event, ctx);
		});
		ports.on("session_start", async (_event, ctx) => {
			currentFastContext = ctx;
			if (!initiallyEnabled) return;
			await enable(ctx, {
				useConfiguredModel: initialUseConfiguredModel,
				useLowThinking: initialUseLowThinking,
			});
		});
	}

	return {
		applyTarget,
		extension,
		formatTarget(target) {
			return formatModel(target.model);
		},
		getThinkingLevel() {
			return ports.getThinkingLevel();
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
