import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionManager,
	SettingsManager,
} from "../dist/runtime/bundle/index.js";
import { createFastSessionController } from "../src/fast-session.js";
import { createPrewalkExtension } from "../src/prewalk.js";

const ORIGINAL_MODEL = { provider: "provider-a", id: "original", reasoning: true };
const FAST_MODEL = { provider: "provider-b", id: "fast", reasoning: true };
const USER_MODEL = { provider: "provider-c", id: "user", reasoning: true };

test("the CLI composes Prewalk with the shared Fast controller and the build copies both modules", async () => {
	const packageDir = new URL("..", import.meta.url);
	const [cliSource, buildSource] = await Promise.all([
		readFile(new URL("src/cli.js", packageDir), "utf8"),
		readFile(new URL("scripts/build.mjs", packageDir), "utf8"),
	]);
	assert.match(cliSource, /createFastSessionController/);
	assert.match(cliSource, /createPrewalkExtension\(\{ fastController \}\)/);
	assert.match(cliSource, /fastController\.extension\(pi\);\s+prewalkExtension\(pi\);/);
	assert.match(buildSource, /"src", "fast-session\.js"/);
	assert.match(buildSource, /"src", "prewalk\.js"/);
});

function createPrewalkHarness({
	configuredModel = "provider-b/fast",
	authenticatedProviders = ["provider-a", "provider-b", "provider-c"],
	cwd,
	idle = true,
	trusted = true,
	tools,
} = {}) {
	const commands = new Map();
	const handlers = new Map();
	const notifications = [];
	const models = [ORIGINAL_MODEL, FAST_MODEL, USER_MODEL];
	const state = {
		authenticatedProviders: new Set(authenticatedProviders),
		idle,
		model: ORIGINAL_MODEL,
		modelChanges: 0,
		sessionToken: {},
		thinking: "high",
		thinkingChanges: 0,
		tools:
			tools ??
			["edit", "write", "read", "grep", "find", "ls"].map((name) => ({
				name,
				sourceInfo: { path: `<builtin:${name}>`, source: "builtin" },
			})),
		trusted,
		workflowToken: {},
	};
	const context = {
		cwd,
		ui: { notify: (message, type) => notifications.push({ message, type }) },
		modelRegistry: {
			find(provider, modelId) {
				return models.find((model) => model.provider === provider && model.id === modelId);
			},
			hasConfiguredAuth(model) {
				return state.authenticatedProviders.has(model.provider);
			},
		},
		isIdle: () => state.idle,
		isProjectTrusted: () => state.trusted,
	};
	Object.defineProperty(context, "model", { get: () => state.model });

	async function emit(name, event) {
		for (const handler of handlers.get(name) ?? []) await handler(event, context);
	}

	const pi = {
		getAllTools: () => state.tools,
		getThinkingLevel: () => state.thinking,
		on(name, handler) {
			const eventHandlers = handlers.get(name) ?? [];
			eventHandlers.push(handler);
			handlers.set(name, eventHandlers);
		},
		registerCommand(name, command) {
			commands.set(name, command);
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
	const fastController = createFastSessionController({
		env: configuredModel ? { BYZ_FAST_MODEL: configuredModel } : {},
	});
	fastController.extension(pi);
	createPrewalkExtension({ fastController })(pi);

	return {
		context,
		emit,
		fastController,
		notifications,
		state,
		async runPrewalk(args = "") {
			await commands.get("prewalk").handler(args, context);
		},
		async runFast(args = "") {
			await commands.get("fast").handler(args, context);
		},
		async toolResult(toolName, path, { isError = false } = {}) {
			await emit("tool_result", { type: "tool_result", input: { path }, isError, toolName });
		},
	};
}

function providerConfig(faux) {
	const model = faux.getModel();
	return {
		baseUrl: model.baseUrl,
		apiKey: "faux-key",
		api: faux.api,
		streamSimple: faux.streamSimple,
		models: faux.models.map((registeredModel) => ({
			id: registeredModel.id,
			name: registeredModel.name,
			api: registeredModel.api,
			reasoning: registeredModel.reasoning,
			input: registeredModel.input,
			cost: registeredModel.cost,
			contextWindow: registeredModel.contextWindow,
			maxTokens: registeredModel.maxTokens,
			baseUrl: registeredModel.baseUrl,
		})),
	};
}

test("actual Prewalk and Fast composition hands the next request off after built-in writes", async (t) => {
	for (const toolName of ["edit", "write"]) {
		await t.test(toolName, async () => {
			const root = await mkdtemp(join(tmpdir(), `byz-prewalk-timing-${toolName}-`));
			const agentDir = join(root, "agent");
			const outputPath = join(root, "proof.txt");
			const faux = createFauxCore({
				models: [
					{ id: "planner", name: "Planner", reasoning: true },
					{ id: "fast", name: "Fast", reasoning: true },
				],
			});
			const calls = [];
			const toolCallId = `prewalk-${toolName}`;
			let session;

			await mkdir(agentDir, { recursive: true });
			await writeFile(join(agentDir, "auth.json"), JSON.stringify({ faux: { type: "api_key", key: "faux-key" } }));
			if (toolName === "edit") await writeFile(outputPath, "before handoff\n");
			const toolInput =
				toolName === "write"
					? { path: "proof.txt", content: "written before handoff\n" }
					: { path: "proof.txt", oldText: "before handoff", newText: "edited before handoff" };
			faux.setResponses([
				(context, options, _state, model) => {
					calls.push({ model: model.id, reasoning: options?.reasoning, messages: context.messages });
					return fauxAssistantMessage(fauxToolCall(toolName, toolInput, { id: toolCallId }), {
						stopReason: "toolUse",
					});
				},
				(context, options, _state, model) => {
					calls.push({ model: model.id, reasoning: options?.reasoning, messages: context.messages });
					return fauxAssistantMessage("handoff complete");
				},
			]);

			try {
				const fastController = createFastSessionController({ env: { BYZ_FAST_MODEL: "faux/fast" } });
				const services = await createAgentSessionServices({
					agentDir,
					cwd: root,
					settingsManager: SettingsManager.inMemory(),
					resourceLoaderOptions: {
						extensionFactories: [
							{
								name: "byz-prewalk-under-test",
								factory: (pi) => {
									pi.registerProvider(faux.getModel().provider, providerConfig(faux));
									fastController.extension(pi);
									createPrewalkExtension({ fastController })(pi);
								},
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
					model: faux.getModel("planner"),
					thinkingLevel: "high",
				}));
				await session.bindExtensions({});
				await session.prompt("/prewalk");
				await session.prompt(`${toolName} the proof file`);

				assert.deepEqual(
					calls.map(({ model, reasoning }) => ({ model, reasoning })),
					[
						{ model: "planner", reasoning: "high" },
						{ model: "fast", reasoning: "low" },
					],
				);
				assert.equal(session.model?.id, "fast");
				assert.equal(session.thinkingLevel, "low");
				assert.equal(
					await readFile(outputPath, "utf8"),
					toolName === "write" ? "written before handoff\n" : "edited before handoff\n",
				);
				assert.equal(
					calls[1].messages.some(
						(message) => message.role === "toolResult" && message.toolCallId === toolCallId && !message.isError,
					),
					true,
				);
			} finally {
				session?.dispose();
				await rm(root, { force: true, recursive: true });
			}
		});
	}
});

test("prewalk commands arm, report, and cancel without changing session state", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-prewalk-commands-"));
	try {
		const harness = createPrewalkHarness({ cwd: root });
		const sessionToken = harness.state.sessionToken;
		const workflowToken = harness.state.workflowToken;

		await harness.runPrewalk();
		assert.match(harness.notifications.at(-1).message, /^Prewalk: armed; target=provider-b\/fast; thinking=low$/);
		await harness.runPrewalk();
		assert.equal(harness.notifications.at(-1).message, "Prewalk is already armed.");
		await harness.runPrewalk("status");
		assert.match(harness.notifications.at(-1).message, /^Prewalk: armed;/);
		await harness.runPrewalk("cancel");
		assert.equal(harness.notifications.at(-1).message, "Prewalk: canceled.");
		await harness.runPrewalk("cancel");
		assert.equal(harness.notifications.at(-1).message, "Prewalk: not armed.");
		await harness.runPrewalk("status");
		assert.equal(harness.notifications.at(-1).message, "Prewalk: not armed.");
		await harness.runPrewalk("toggle");
		assert.deepEqual(harness.notifications.at(-1), {
			message: "Usage: /prewalk [cancel|status]",
			type: "warning",
		});
		assert.equal(harness.state.model, ORIGINAL_MODEL);
		assert.equal(harness.state.thinking, "high");
		assert.equal(harness.state.sessionToken, sessionToken);
		assert.equal(harness.state.workflowToken, workflowToken);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("prewalk rejects busy, untrusted, Fast-active, and overridden-tool sessions", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-prewalk-guards-"));
	try {
		await t.test("busy", async () => {
			const harness = createPrewalkHarness({ cwd: root, idle: false });
			await harness.runPrewalk();
			assert.equal(harness.notifications.at(-1).message, "Prewalk cannot arm while the agent is busy.");
		});
		await t.test("untrusted", async () => {
			const harness = createPrewalkHarness({ cwd: root, trusted: false });
			await harness.runPrewalk();
			assert.equal(harness.notifications.at(-1).message, "Prewalk requires a trusted project.");
		});
		await t.test("Fast active", async () => {
			const harness = createPrewalkHarness({ cwd: root });
			await harness.runFast("on");
			const fastState = { model: harness.state.model, thinking: harness.state.thinking };
			await harness.runPrewalk();
			assert.equal(harness.notifications.at(-1).message, "Prewalk cannot arm while Fast is already on.");
			assert.deepEqual({ model: harness.state.model, thinking: harness.state.thinking }, fastState);
			assert.equal(harness.fastController.isActive(), true);
		});
		for (const toolName of ["edit", "write"]) {
			await t.test(`${toolName} override`, async () => {
				const harness = createPrewalkHarness({ cwd: root });
				harness.state.tools = harness.state.tools.map((tool) =>
					tool.name === toolName
						? { ...tool, sourceInfo: { path: `/extension/${toolName}.js`, source: "extension" } }
						: tool,
				);
				await harness.runPrewalk();
				assert.equal(harness.notifications.at(-1).message, "Prewalk requires the built-in edit and write tools.");
			});
		}
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("prewalk target validation fails closed without changing model or thinking", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-prewalk-target-"));
	try {
		for (const scenario of [
			{ name: "invalid", configuredModel: "invalid" },
			{ name: "missing", configuredModel: "provider-b/missing" },
			{
				name: "unauthenticated",
				configuredModel: "provider-b/fast",
				authenticatedProviders: ["provider-a"],
			},
			{
				name: "unauthenticated current model",
				configuredModel: "",
				authenticatedProviders: [],
			},
		]) {
			await t.test(scenario.name, async () => {
				const harness = createPrewalkHarness({ cwd: root, ...scenario });
				await harness.runPrewalk();
				assert.equal(harness.notifications.at(-1).type, "error");
				assert.equal(harness.state.model, ORIGINAL_MODEL);
				assert.equal(harness.state.thinking, "high");
				await harness.runPrewalk("status");
				assert.equal(harness.notifications.at(-1).message, "Prewalk: not armed.");
			});
		}
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("only a successful built-in workspace edit or write consumes prewalk", async (t) => {
	for (const toolName of ["edit", "write"]) {
		await t.test(toolName, async () => {
			const root = await mkdtemp(join(tmpdir(), `byz-prewalk-${toolName}-`));
			try {
				const harness = createPrewalkHarness({ cwd: root });
				const targetPath = join(root, `${toolName}.txt`);
				await writeFile(targetPath, "changed\n");
				await harness.runPrewalk();
				for (const ignoredTool of ["read", "grep", "find", "ls", "bash"]) {
					await harness.toolResult(ignoredTool, targetPath);
				}
				await harness.toolResult(toolName, targetPath, { isError: true });
				assert.equal(harness.state.model, ORIGINAL_MODEL);
				assert.equal(harness.state.thinking, "high");

				await harness.toolResult(toolName, targetPath);
				assert.equal(harness.state.model, FAST_MODEL);
				assert.equal(harness.state.thinking, "low");
				assert.equal(harness.state.modelChanges, 1);
				await harness.runPrewalk("status");
				assert.equal(harness.notifications.at(-1).message, "Prewalk: not armed.");

				await harness.toolResult(toolName, targetPath);
				assert.equal(harness.state.modelChanges, 1);
			} finally {
				await rm(root, { force: true, recursive: true });
			}
		});
	}
});

test("prewalk rejects symlink escapes and rechecks built-in tool identity before consuming", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-prewalk-boundary-"));
	const outside = await mkdtemp(join(tmpdir(), "byz-prewalk-outside-"));
	try {
		const harness = createPrewalkHarness({ cwd: root });
		const validPath = join(root, "valid.txt");
		const outsidePath = join(outside, "outside.txt");
		const linkedDirectory = join(root, "linked-directory");
		const linkedFile = join(root, "linked-file.txt");
		await writeFile(validPath, "valid\n");
		await writeFile(outsidePath, "outside\n");
		await symlink(outside, linkedDirectory);
		await symlink(outsidePath, linkedFile);

		await harness.runPrewalk();
		await harness.toolResult("write", join(linkedDirectory, "outside.txt"));
		await harness.toolResult("edit", linkedFile);
		assert.equal(harness.state.model, ORIGINAL_MODEL);
		assert.equal(harness.state.thinking, "high");

		harness.state.tools = harness.state.tools.map((tool) =>
			tool.name === "write" ? { ...tool, sourceInfo: { path: "/extension/write.js", source: "extension" } } : tool,
		);
		await harness.toolResult("edit", validPath);
		assert.equal(harness.state.model, ORIGINAL_MODEL);
		harness.state.tools = harness.state.tools.map((tool) =>
			tool.name === "write" ? { ...tool, sourceInfo: { path: "<builtin:write>", source: "builtin" } } : tool,
		);
		await harness.toolResult("write", validPath);
		assert.equal(harness.state.model, FAST_MODEL);
		assert.equal(harness.state.thinking, "low");
	} finally {
		await rm(root, { force: true, recursive: true });
		await rm(outside, { force: true, recursive: true });
	}
});

test("parallel candidates are serialized and only one valid write consumes prewalk", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-prewalk-parallel-"));
	const outside = await mkdtemp(join(tmpdir(), "byz-prewalk-parallel-outside-"));
	try {
		const harness = createPrewalkHarness({ cwd: root });
		const first = join(root, "first.txt");
		const second = join(root, "second.txt");
		const outsidePath = join(outside, "outside.txt");
		await Promise.all([
			writeFile(first, "first\n"),
			writeFile(second, "second\n"),
			writeFile(outsidePath, "outside\n"),
		]);

		await harness.runPrewalk();
		await Promise.all([
			harness.toolResult("write", outsidePath),
			harness.toolResult("write", first),
			harness.toolResult("edit", second),
		]);
		assert.equal(harness.state.model, FAST_MODEL);
		assert.equal(harness.state.thinking, "low");
		assert.equal(harness.state.modelChanges, 1);
		assert.equal(harness.state.thinkingChanges, 1);
	} finally {
		await rm(root, { force: true, recursive: true });
		await rm(outside, { force: true, recursive: true });
	}
});

test("explicit model or thinking changes cancel prewalk and preserve the user selection", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-prewalk-explicit-"));
	try {
		const modelHarness = createPrewalkHarness({ cwd: root });
		await modelHarness.runPrewalk();
		const previousModel = modelHarness.state.model;
		modelHarness.state.model = USER_MODEL;
		await modelHarness.emit("model_select", {
			type: "model_select",
			model: USER_MODEL,
			previousModel,
			source: "set",
		});
		assert.equal(
			modelHarness.notifications.at(-1).message,
			"Prewalk: canceled after an explicit model or thinking change.",
		);
		assert.equal(modelHarness.state.model, USER_MODEL);
		assert.equal(modelHarness.state.thinking, "high");

		const thinkingHarness = createPrewalkHarness({ cwd: root });
		await thinkingHarness.runPrewalk();
		thinkingHarness.state.thinking = "medium";
		await thinkingHarness.emit("thinking_level_select", {
			type: "thinking_level_select",
			level: "medium",
			previousLevel: "high",
		});
		assert.equal(
			thinkingHarness.notifications.at(-1).message,
			"Prewalk: canceled after an explicit model or thinking change.",
		);
		assert.equal(thinkingHarness.state.model, ORIGINAL_MODEL);
		assert.equal(thinkingHarness.state.thinking, "medium");
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("enabling Fast cancels an armed prewalk without changing Fast behavior", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-prewalk-fast-cancel-"));
	try {
		const harness = createPrewalkHarness({ cwd: root });
		await harness.runPrewalk();
		await harness.runFast("on");
		assert.equal(harness.notifications.at(-2).message, "Prewalk: canceled because Fast was enabled.");
		assert.match(harness.notifications.at(-1).message, /^Fast: on;/);
		assert.equal(harness.fastController.isActive(), true);
		assert.equal(harness.state.model, FAST_MODEL);
		assert.equal(harness.state.thinking, "low");
		await harness.runPrewalk("status");
		assert.equal(harness.notifications.at(-1).message, "Prewalk: not armed.");
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});
