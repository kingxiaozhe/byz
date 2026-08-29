import { getActiveByzOptionIndexes } from "./workflow-switch.js";

export { createFastSessionController, createFastSwitchExtension } from "./fast-session.js";

const SESSION_OPTIONS = new Set(["--continue", "-c", "--resume", "-r", "--session", "--session-id", "--fork"]);
const THINKING_SUFFIX_PATTERN = /:(off|minimal|low|medium|high|xhigh|max)$/;

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
