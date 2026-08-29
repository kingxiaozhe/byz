import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getModels } from "@earendil-works/pi-ai/compat";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionManager,
	SettingsManager,
} from "../dist/runtime/bundle/index.js";
import { createFastSwitchExtension } from "../src/fast-session.js";

const ORIGINAL_MODEL = { provider: "provider-a", id: "original", reasoning: true };
const FAST_MODEL = { provider: "provider-b", id: "fast", reasoning: true };
const USER_MODEL = { provider: "provider-c", id: "user", reasoning: true };
const [SESSION_MODEL, SESSION_FAST_MODEL, SESSION_USER_MODEL] = getModels("anthropic").filter(
	(model) => model.reasoning,
);
const SESSION_NO_AUTH_MODEL = getModels("openai")[0];

function createHarness({
	configuredModel,
	authenticatedProviders = ["provider-a", "provider-b", "provider-c"],
	initialModel = ORIGINAL_MODEL,
	initiallyEnabled = false,
} = {}) {
	const commands = new Map();
	const handlers = new Map();
	const notifications = [];
	const models = [ORIGINAL_MODEL, FAST_MODEL, USER_MODEL];
	const state = {
		idle: true,
		model: initialModel === null ? undefined : initialModel,
		thinking: "high",
		authenticatedProviders: new Set(authenticatedProviders),
		modelChanges: 0,
		thinkingChanges: 0,
		sessionToken: {},
		workflowToken: {},
	};
	const context = {
		ui: {
			notify(message, type) {
				notifications.push({ message, type });
			},
		},
		modelRegistry: {
			find(provider, modelId) {
				return models.find((model) => model.provider === provider && model.id === modelId);
			},
			hasConfiguredAuth(model) {
				return state.authenticatedProviders.has(model.provider);
			},
		},
		isIdle() {
			return state.idle;
		},
	};
	Object.defineProperty(context, "model", { get: () => state.model });

	async function emit(name, event) {
		const handler = handlers.get(name);
		if (handler) await handler(event, context);
	}

	const pi = {
		registerCommand(name, command) {
			commands.set(name, command);
		},
		on(name, handler) {
			handlers.set(name, handler);
		},
		getThinkingLevel() {
			return state.thinking;
		},
		async setModel(model) {
			if (!state.authenticatedProviders.has(model.provider)) return false;
			const previousModel = state.model;
			state.model = model;
			state.modelChanges += 1;
			await emit("model_select", { type: "model_select", model, previousModel, source: "set" });
			return true;
		},
		setThinkingLevel(level) {
			const previousLevel = state.thinking;
			state.thinking = level;
			state.thinkingChanges += 1;
			void emit("thinking_level_select", { type: "thinking_level_select", level, previousLevel });
		},
	};
	createFastSwitchExtension({
		env: configuredModel ? { BYZ_FAST_MODEL: configuredModel } : {},
		initiallyEnabled,
	})(pi);

	return {
		state,
		context,
		notifications,
		async run(args = "") {
			await commands.get("fast").handler(args, context);
		},
		emit,
	};
}

test("session_start applies configured Fast defaults and keeps them reversible", async () => {
	const harness = createHarness({ configuredModel: "provider-b/fast", initiallyEnabled: true });
	await harness.emit("session_start", { type: "session_start" });
	assert.equal(harness.state.model, FAST_MODEL);
	assert.equal(harness.state.thinking, "low");
	await harness.run("off");
	assert.equal(harness.state.model, ORIGINAL_MODEL);
	assert.equal(harness.state.thinking, "high");
});

test("session_start enables Fast while preserving explicit startup choices", async () => {
	const commands = new Map();
	const handlers = new Map();
	const notifications = [];
	const state = { model: ORIGINAL_MODEL, thinking: "medium" };
	const context = {
		ui: { notify: (message, type) => notifications.push({ message, type }) },
		modelRegistry: {
			find: () => FAST_MODEL,
			hasConfiguredAuth: () => true,
		},
		isIdle: () => true,
	};
	Object.defineProperty(context, "model", { get: () => state.model });
	createFastSwitchExtension({
		env: { BYZ_FAST_MODEL: "provider-b/fast" },
		initiallyEnabled: true,
		initialUseConfiguredModel: false,
		initialUseLowThinking: false,
	})({
		registerCommand: (name, command) => commands.set(name, command),
		on: (name, handler) => handlers.set(name, handler),
		getThinkingLevel: () => state.thinking,
		setModel: async (model) => {
			state.model = model;
			return true;
		},
		setThinkingLevel: (level) => {
			state.thinking = level;
		},
	});

	await handlers.get("session_start")({ type: "session_start" }, context);
	assert.equal(state.model, ORIGINAL_MODEL);
	assert.equal(state.thinking, "medium");
	assert.match(notifications.at(-1).message, /^Fast: on;/);
	await commands.get("fast").handler("off", context);
	assert.equal(state.model, ORIGINAL_MODEL);
	assert.equal(state.thinking, "medium");
});

test("Fast without BYZ_FAST_MODEL only lowers thinking and restores it", async () => {
	const harness = createHarness();
	await harness.run("on");
	assert.equal(harness.state.model, ORIGINAL_MODEL);
	assert.equal(harness.state.thinking, "low");
	assert.match(harness.notifications.at(-1).message, /^Fast: on;/);

	await harness.run("off");
	assert.equal(harness.state.model, ORIGINAL_MODEL);
	assert.equal(harness.state.thinking, "high");
	assert.match(harness.notifications.at(-1).message, /^Fast: off;/);
});

test("Fast without a selected model still lowers and restores thinking", async () => {
	const harness = createHarness({ initialModel: null });
	await harness.run("on");
	assert.equal(harness.state.model, undefined);
	assert.equal(harness.state.thinking, "low");
	assert.match(harness.notifications.at(-1).message, /^Fast: on; model=none;/);

	await harness.run("off");
	assert.equal(harness.state.model, undefined);
	assert.equal(harness.state.thinking, "high");
	assert.match(harness.notifications.at(-1).message, /^Fast: off; model=none;/);
});

test("Fast rejects a configured target when no original model can be restored", async () => {
	const harness = createHarness({ configuredModel: "provider-b/fast", initialModel: null });
	await harness.run("on");
	assert.equal(harness.state.model, undefined);
	assert.equal(harness.state.thinking, "high");
	assert.equal(harness.notifications.at(-1).type, "error");
	await harness.run("status");
	assert.match(harness.notifications.at(-1).message, /^Fast: off; model=none;/);
});

test("Fast switches to a configured target and restores the original session state", async () => {
	const harness = createHarness({ configuredModel: "provider-b/fast" });
	const sessionToken = harness.state.sessionToken;
	const workflowToken = harness.state.workflowToken;

	await harness.run("on");
	assert.equal(harness.state.model, FAST_MODEL);
	assert.equal(harness.state.thinking, "low");
	await harness.run("off");

	assert.equal(harness.state.model, ORIGINAL_MODEL);
	assert.equal(harness.state.thinking, "high");
	assert.equal(harness.state.sessionToken, sessionToken);
	assert.equal(harness.state.workflowToken, workflowToken);
});

test("Fast runs through a real AgentSession command without replacing the conversation", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-fast-session-"));
	const agentDir = join(root, "agent");
	const notifications = [];
	const delayedThinkingEvents = [];
	let delayThinkingEvents = false;
	let session;
	await mkdir(agentDir, { recursive: true });
	await writeFile(join(agentDir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "test-key" } }));

	try {
		const settingsManager = SettingsManager.inMemory();
		settingsManager.setModelThinkingLevel(SESSION_FAST_MODEL.provider, SESSION_FAST_MODEL.id, "off");
		const delayExtension = (pi) => {
			pi.on("thinking_level_select", () => {
				if (!delayThinkingEvents) return;
				return new Promise((resolve) => delayedThinkingEvents.push(resolve));
			});
		};
		const services = await createAgentSessionServices({
			agentDir,
			cwd: root,
			settingsManager,
			resourceLoaderOptions: {
				extensionFactories: [
					{ factory: delayExtension, name: "thinking-delay" },
					{
						factory: createFastSwitchExtension({
							env: { BYZ_FAST_MODEL: `${SESSION_FAST_MODEL.provider}/${SESSION_FAST_MODEL.id}` },
							initiallyEnabled: true,
							initialUseConfiguredModel: true,
							initialUseLowThinking: false,
						}),
						name: "byz-fast",
					},
				],
				noPromptTemplates: true,
				noSkills: true,
				noThemes: true,
			},
		});
		({ session } = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(),
			model: SESSION_MODEL,
			thinkingLevel: "high",
		}));
		await session.bindExtensions({
			mode: "tui",
			uiContext: {
				select: async () => undefined,
				confirm: async () => false,
				input: async () => undefined,
				notify(message, type) {
					notifications.push({ message, type });
				},
				onTerminalInput: () => () => {},
				setStatus: () => {},
				setWorkingMessage: () => {},
				setWorkingVisible: () => {},
				setWorkingIndicator: () => {},
				setHiddenThinkingLabel: () => {},
				setWidget: () => {},
				setFooter: () => {},
				setHeader: () => {},
				setTitle: () => {},
				custom: async () => undefined,
			},
		});
		assert.equal(session.model?.id, SESSION_FAST_MODEL.id);
		assert.equal(session.thinkingLevel, "high");
		assert.match(notifications.at(-1)?.message ?? "", /^Fast: on;/);
		await session.prompt("/fast off");
		assert.equal(session.model?.id, SESSION_MODEL.id);
		assert.equal(session.thinkingLevel, "high");
		session.setThinkingLevel("high");
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(session.thinkingLevel, "high");
		session.agent.state.messages = [{ role: "user", content: "existing conversation", timestamp: Date.now() }];
		const extensionRunner = session.extensionRunner;

		delayThinkingEvents = true;
		await session.prompt("/fast on");
		assert.equal(session.model?.id, SESSION_FAST_MODEL.id);
		assert.equal(session.thinkingLevel, "low");
		assert.ok(delayedThinkingEvents.length >= 2);
		delayThinkingEvents = false;
		for (const resolve of delayedThinkingEvents.splice(0)) resolve();
		await new Promise((resolve) => setImmediate(resolve));
		await session.prompt("/fast off");
		assert.equal(session.model?.id, SESSION_MODEL.id);
		assert.match(notifications.at(-1)?.message ?? "", /^Fast: off;/);
		assert.equal(session.thinkingLevel, "high");

		await session.prompt("/fast on");
		await session.setModel(SESSION_USER_MODEL);
		await new Promise((resolve) => setImmediate(resolve));
		await session.prompt("/fast off");
		assert.equal(session.model?.id, SESSION_USER_MODEL.id);
		assert.match(notifications.at(-1)?.message ?? "", /^Fast: off;/);
		assert.equal(session.extensionRunner, extensionRunner);
		assert.equal(session.messages.length, 1);
		assert.equal(session.messages[0].role, "user");
	} finally {
		session?.dispose();
		await rm(root, { force: true, recursive: true });
	}
});

test("real AgentSession rejects an unauthenticated configured target without changing state", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-fast-no-auth-"));
	const agentDir = join(root, "agent");
	const notifications = [];
	let session;
	await mkdir(agentDir, { recursive: true });
	await writeFile(join(agentDir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "test-key" } }));

	try {
		const services = await createAgentSessionServices({
			agentDir,
			cwd: root,
			settingsManager: SettingsManager.inMemory(),
			resourceLoaderOptions: {
				extensionFactories: [
					{
						factory: createFastSwitchExtension({
							env: { BYZ_FAST_MODEL: `${SESSION_NO_AUTH_MODEL.provider}/${SESSION_NO_AUTH_MODEL.id}` },
						}),
						name: "byz-fast",
					},
				],
				noPromptTemplates: true,
				noSkills: true,
				noThemes: true,
			},
		});
		({ session } = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(),
			model: SESSION_MODEL,
			thinkingLevel: "high",
		}));
		await session.bindExtensions({
			mode: "tui",
			uiContext: {
				select: async () => undefined,
				confirm: async () => false,
				input: async () => undefined,
				notify(message, type) {
					notifications.push({ message, type });
				},
				onTerminalInput: () => () => {},
				setStatus: () => {},
				setWorkingMessage: () => {},
				setWorkingVisible: () => {},
				setWorkingIndicator: () => {},
				setHiddenThinkingLabel: () => {},
				setWidget: () => {},
				setFooter: () => {},
				setHeader: () => {},
				setTitle: () => {},
				custom: async () => undefined,
			},
		});
		session.setThinkingLevel("high");
		await new Promise((resolve) => setImmediate(resolve));

		await session.prompt("/fast on");
		assert.equal(session.model?.id, SESSION_MODEL.id);
		assert.equal(session.thinkingLevel, "high");
		assert.equal(notifications.at(-1)?.type, "error");
		await session.prompt("/fast status");
		assert.match(notifications.at(-1)?.message ?? "", /^Fast: off;/);
	} finally {
		session?.dispose();
		await rm(root, { force: true, recursive: true });
	}
});

test("invalid, missing, and unauthenticated targets leave all state unchanged", async (t) => {
	for (const scenario of [
		{ name: "invalid", configuredModel: "invalid" },
		{ name: "missing", configuredModel: "provider-b/missing" },
		{ name: "unauthenticated", configuredModel: "provider-b/fast", authenticatedProviders: ["provider-a"] },
		{ name: "same target without auth", configuredModel: "provider-a/original", authenticatedProviders: [] },
	]) {
		await t.test(scenario.name, async () => {
			const harness = createHarness(scenario);
			await harness.run("on");
			assert.equal(harness.state.model, ORIGINAL_MODEL);
			assert.equal(harness.state.thinking, "high");
			assert.match(harness.notifications.at(-1).type, /error/);
			await harness.run("status");
			assert.match(harness.notifications.at(-1).message, /^Fast: off;/);
		});
	}
});

test("status and duplicate commands do not repeat transitions", async () => {
	const harness = createHarness({ configuredModel: "provider-b/fast" });
	await harness.run();
	await harness.run("status");
	assert.match(harness.notifications.at(-1).message, /^Fast: off;/);

	await harness.run("on");
	const afterEnable = { model: harness.state.modelChanges, thinking: harness.state.thinkingChanges };
	await harness.run("on");
	assert.deepEqual({ model: harness.state.modelChanges, thinking: harness.state.thinkingChanges }, afterEnable);

	await harness.run("off");
	const afterDisable = { model: harness.state.modelChanges, thinking: harness.state.thinkingChanges };
	await harness.run("off");
	assert.deepEqual({ model: harness.state.modelChanges, thinking: harness.state.thinkingChanges }, afterDisable);
});

test("failed model restoration keeps Fast active and retains the snapshot for retry", async () => {
	const harness = createHarness({ configuredModel: "provider-b/fast" });
	await harness.run("on");
	harness.state.authenticatedProviders.delete("provider-a");
	await harness.run("off");
	assert.equal(harness.state.model, FAST_MODEL);
	assert.equal(harness.state.thinking, "low");
	assert.equal(harness.notifications.at(-1).type, "error");
	await harness.run("status");
	assert.match(harness.notifications.at(-1).message, /^Fast: on;/);

	harness.state.authenticatedProviders.add("provider-a");
	await harness.run("off");
	assert.equal(harness.state.model, ORIGINAL_MODEL);
	assert.equal(harness.state.thinking, "high");
});

test("explicit model or thinking selections exit Fast without restoring the snapshot", async () => {
	const modelHarness = createHarness({ configuredModel: "provider-b/fast" });
	await modelHarness.run("on");
	modelHarness.state.model = USER_MODEL;
	await modelHarness.emit("model_select", {
		type: "model_select",
		model: USER_MODEL,
		previousModel: FAST_MODEL,
		source: "set",
	});
	await modelHarness.run("off");
	assert.equal(modelHarness.state.model, USER_MODEL);

	const thinkingHarness = createHarness();
	await thinkingHarness.run("on");
	thinkingHarness.state.thinking = "medium";
	await thinkingHarness.emit("thinking_level_select", {
		type: "thinking_level_select",
		level: "medium",
		previousLevel: "low",
	});
	await thinkingHarness.run("off");
	assert.equal(thinkingHarness.state.thinking, "medium");
});

test("busy sessions reject on and off without changing Fast state", async () => {
	const harness = createHarness({ configuredModel: "provider-b/fast" });
	harness.state.idle = false;
	await harness.run("on");
	assert.equal(harness.state.model, ORIGINAL_MODEL);
	assert.equal(harness.state.thinking, "high");
	assert.equal(harness.notifications.at(-1).type, "warning");

	harness.state.idle = true;
	await harness.run("on");
	harness.state.idle = false;
	await harness.run("off");
	assert.equal(harness.state.model, FAST_MODEL);
	assert.equal(harness.state.thinking, "low");
	assert.equal(harness.notifications.at(-1).type, "warning");

	harness.state.idle = true;
	await harness.run("status");
	assert.match(harness.notifications.at(-1).message, /^Fast: on;/);
});

test("invalid command arguments report the supported contract", async () => {
	const harness = createHarness();
	await harness.run("toggle");
	assert.deepEqual(harness.notifications.at(-1), {
		message: "Usage: /fast [on|off|status]",
		type: "warning",
	});
});
