import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createPiExtensionPorts,
	createPiRuntimeAdapter,
} from "../.byz-output/current/dist/adapters/pi/pi-runtime-adapter.js";
import { createConversationExtension } from "../.byz-output/current/dist/conversation/conversation-extension.js";
import { createDiagnosticsExtension } from "../.byz-output/current/dist/diagnostics/diagnostics-extension.js";
import { createFastSessionController } from "../.byz-output/current/dist/fast-session.js";
import { createPrewalkExtension } from "../.byz-output/current/dist/prewalk.js";
import { createWorkflowSwitchExtension } from "../.byz-output/current/dist/workflow-switch.js";
import { checkArchitecture } from "../scripts/check-architecture.mjs";

async function withFixture(run) {
	const root = await mkdtemp(join(tmpdir(), "byz-architecture-"));
	try {
		await mkdir(join(root, "src", "application", "ports"), { recursive: true });
		await mkdir(join(root, "src", "domain"), { recursive: true });
		await mkdir(join(root, "src", "adapters", "pi"), { recursive: true });
		return await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("Pi extension adapter exposes only feature-scoped capability facades", async () => {
	const handlers = new Map();
	const commands = new Map();
	const rawModel = { provider: "private-provider", id: "private-model", secret: "must-not-leak" };
	let rawFooterFactory;
	const rawContext = {
		secretPiCapability() {},
		cwd: "/workspace",
		isIdle: () => true,
		isProjectTrusted: () => true,
		model: rawModel,
		thinkingLevel: "high",
		modelRegistry: {
			find: () => rawModel,
			hasConfiguredAuth: () => true,
		},
		sessionManager: {
			getCwd: () => "/workspace",
			getEntries: () => [{ type: "message", message: { role: "assistant", usage: { input: 2, secret: "drop" } } }],
		},
		getContextUsage: () => ({ tokens: 10, contextWindow: 100, percent: 10, secret: "drop" }),
		replaceManagedResources: async () => {},
		ui: {
			notify() {},
			input: async () => undefined,
			setConfirmationPresenter() {},
			setFooter(factory) {
				rawFooterFactory = factory;
			},
			setMessagePresenter() {},
			setTitle() {},
			setToolExecutionVisible() {},
			setWorkingMessage() {},
			secretUiCapability() {},
		},
	};
	let selectedModel;
	const pi = {
		secretPiCapability() {},
		on(name, handler) {
			handlers.set(name, handler);
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
		getAllTools: () => [{ name: "edit", sourceInfo: { source: "builtin", path: "<builtin:edit>" } }],
		getThinkingLevel: () => "high",
		setThinkingLevel() {},
		setModel: async (model) => {
			selectedModel = model;
			return true;
		},
	};
	const ports = createPiExtensionPorts(pi);

	assert.deepEqual(Object.keys(ports), ["diagnostics", "recovery", "workflow", "fast", "prewalk", "conversation"]);
	for (const featurePorts of Object.values(ports)) {
		assert.equal("secretPiCapability" in featurePorts, false);
		assert.equal("raw" in featurePorts, false);
		assert.equal("api" in featurePorts, false);
	}
	assert.deepEqual(Object.keys(ports.diagnostics), ["on"]);
	assert.deepEqual(Object.keys(ports.recovery), ["on", "registerCommand"]);
	assert.deepEqual(Object.keys(ports.workflow), ["on", "registerCommand"]);
	assert.deepEqual(Object.keys(ports.fast), [
		"on",
		"registerCommand",
		"getThinkingLevel",
		"setModel",
		"setThinkingLevel",
	]);
	assert.deepEqual(Object.keys(ports.prewalk), ["on", "registerCommand", "getAllTools"]);
	assert.deepEqual(Object.keys(ports.conversation), ["on", "registerCommand"]);
	assert.throws(() => ports.diagnostics.on("project_trust", () => {}), /does not allow event/);

	let diagnosticContext;
	ports.diagnostics.on("before_provider_request", (_event, context) => {
		diagnosticContext = context;
	});
	await handlers.get("before_provider_request")({ type: "before_provider_request", payload: "private" }, rawContext);
	assert.deepEqual(Object.keys(diagnosticContext).sort(), ["model", "ui"]);
	assert.deepEqual(diagnosticContext.model, { provider: "private-provider", id: "private-model" });
	assert.equal("secret" in diagnosticContext.model, false);
	assert.equal("secretPiCapability" in diagnosticContext, false);

	let workflowContext;
	ports.workflow.registerCommand("workflow", {
		handler: async (_args, context) => {
			workflowContext = context;
		},
	});
	await commands.get("workflow").handler("cm", rawContext);
	assert.deepEqual(Object.keys(workflowContext).sort(), ["isIdle", "replaceManagedResources", "ui"]);
	assert.equal("secretPiCapability" in workflowContext, false);
	assert.equal(typeof workflowContext.replaceManagedResources, "function");

	let fastContext;
	ports.fast.on("model_select", (_event, context) => {
		fastContext = context;
	});
	await handlers.get("model_select")({ type: "model_select", model: rawModel }, rawContext);
	assert.deepEqual(Object.keys(fastContext).sort(), ["isIdle", "model", "modelRegistry", "ui"]);
	const modelReference = fastContext.modelRegistry.find("private-provider", "private-model");
	assert.deepEqual(modelReference, { provider: "private-provider", id: "private-model" });
	await ports.fast.setModel(modelReference);
	assert.equal(selectedModel, rawModel);

	assert.deepEqual(ports.prewalk.getAllTools(), [
		{ name: "edit", sourceInfo: { source: "builtin", path: "<builtin:edit>" } },
	]);
	let prewalkEvent;
	let prewalkContext;
	ports.prewalk.on("tool_result", (event, context) => {
		prewalkEvent = event;
		prewalkContext = context;
	});
	await handlers.get("tool_result")(
		{ type: "tool_result", toolName: "write", input: { path: "proof.txt", secret: "drop" }, isError: false },
		rawContext,
	);
	assert.deepEqual(prewalkEvent.input, { path: "proof.txt" });
	assert.deepEqual(Object.keys(prewalkContext).sort(), ["cwd", "isIdle", "isProjectTrusted", "ui"]);
	assert.throws(
		() => handlers.get("tool_result")({ type: "tool_result", toolName: "write", input: { path: "proof.txt" } }),
		/missing its Pi context/,
	);

	let conversationContext;
	let projectedToolEnd;
	ports.conversation.on("tool_execution_end", (event) => {
		projectedToolEnd = event;
	});
	const rawArgs = { path: "proof.txt", nested: { secretPiCapability() {} } };
	await handlers.get("tool_execution_end")(
		{ type: "tool_execution_end", toolName: "write", args: rawArgs, isError: false },
		rawContext,
	);
	assert.deepEqual(projectedToolEnd.args, { path: "proof.txt" });
	assert.notEqual(projectedToolEnd.args, rawArgs);

	let projectedMessageUpdate;
	ports.conversation.on("message_update", (event) => {
		projectedMessageUpdate = event;
	});
	await handlers.get("message_update")(
		{
			type: "message_update",
			message: { role: "assistant", usage: { input: 0, output: 0, secret: "drop" }, content: "drop" },
			assistantMessageEvent: { type: "text_delta" },
		},
		rawContext,
	);
	assert.deepEqual(projectedMessageUpdate, {
		type: "message_update",
		message: { role: "assistant", usage: undefined },
	});
	await handlers.get("message_update")(
		{
			type: "message_update",
			message: { role: "assistant", usage: { input: 2, output: 1, cacheWrite: 0, secret: "drop" } },
			assistantMessageEvent: { type: "text_end" },
		},
		rawContext,
	);
	assert.deepEqual(projectedMessageUpdate, {
		type: "message_update",
		message: { role: "assistant", usage: { input: 2, output: 1, cacheWrite: 0 } },
	});

	let projectedMessageEnd;
	ports.conversation.on("message_end", (event) => {
		projectedMessageEnd = event;
	});
	await handlers.get("message_end")(
		{
			type: "message_end",
			message: { role: "assistant", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
		},
		rawContext,
	);
	assert.deepEqual(projectedMessageEnd, {
		type: "message_end",
		message: { role: "assistant", usage: undefined },
	});
	await handlers.get("message_end")(
		{ type: "message_end", message: { role: "assistant", usage: { output: 3, input: -1, secret: "drop" } } },
		rawContext,
	);
	assert.deepEqual(projectedMessageEnd, {
		type: "message_end",
		message: { role: "assistant", usage: { output: 3 } },
	});

	let projectedConversationEnd;
	ports.conversation.on("agent_end", (event) => {
		projectedConversationEnd = event;
	});
	await handlers.get("agent_end")(
		{
			type: "agent_end",
			messages: [{ role: "assistant", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
		},
		rawContext,
	);
	assert.deepEqual(projectedConversationEnd, { type: "agent_end", usage: undefined });
	const rawEndMessages = [
		{ role: "assistant", content: "drop", usage: { input: Number.MAX_SAFE_INTEGER, output: 2 } },
		{ role: "assistant", usage: { input: 1, output: 3 } },
		{ role: "toolResult", content: "drop", usage: { cacheWrite: 0 } },
		{ role: "user", usage: { cacheRead: 99 } },
	];
	await handlers.get("agent_end")({ type: "agent_end", messages: rawEndMessages }, rawContext);
	assert.deepEqual(projectedConversationEnd, { type: "agent_end", usage: { output: 5, cacheWrite: 0 } });
	assert.equal("messages" in projectedConversationEnd, false);

	let projectedDiagnosticEnd;
	ports.diagnostics.on("agent_end", (event) => {
		projectedDiagnosticEnd = event;
	});
	await handlers.get("agent_end")({ type: "agent_end", messages: rawEndMessages }, rawContext);
	assert.equal("usage" in projectedDiagnosticEnd, false);
	assert.deepEqual(projectedDiagnosticEnd.messages[0], { role: "assistant", stopReason: undefined });

	ports.conversation.on("session_start", (_event, context) => {
		conversationContext = context;
	});
	await handlers.get("session_start")({ type: "session_start" }, rawContext);
	assert.deepEqual(Object.keys(conversationContext).sort(), [
		"cwd",
		"getContextUsage",
		"model",
		"sessionManager",
		"thinkingLevel",
		"ui",
	]);
	assert.equal("secretUiCapability" in conversationContext.ui, false);
	assert.deepEqual(conversationContext.sessionManager.getEntries(), [
		{ type: "message", message: { role: "assistant", usage: { input: 2 } }, usage: undefined },
	]);
	assert.deepEqual(conversationContext.getContextUsage(), { tokens: 10, contextWindow: 100, percent: 10 });
	let footerArguments;
	conversationContext.ui.setFooter((tui, theme, footerData) => {
		footerArguments = { tui, theme, footerData };
	});
	rawFooterFactory(
		{ requestRender() {}, secretTuiCapability() {} },
		{ fg: (_color, text) => text, secretThemeCapability() {} },
		{
			onBranchChange: () => () => {},
			getGitBranch: () => "main",
			getExtensionStatuses: () => new Map([["workflow", "cm"]]),
			secretFooterCapability() {},
		},
	);
	assert.deepEqual(Object.keys(footerArguments.tui), ["requestRender"]);
	assert.deepEqual(Object.keys(footerArguments.theme), ["fg"]);
	assert.deepEqual(Object.keys(footerArguments.footerData), [
		"onBranchChange",
		"getGitBranch",
		"getExtensionStatuses",
	]);
});

for (const reason of ["startup", "reload", "new", "resume", "fork"]) {
	test(`Recovery facade projects the ${reason} session_start reason through a minimal context`, async () => {
		let rawHandler;
		let recoveryEvent;
		let recoveryContext;
		let getEntriesCalls = 0;
		const ports = createPiExtensionPorts({
			on(name, handler) {
				assert.equal(name, "session_start");
				rawHandler = handler;
			},
			registerCommand() {},
			getAllTools: () => [],
			getThinkingLevel: () => "high",
			setThinkingLevel() {},
			setModel: async () => true,
		});
		ports.recovery.on("session_start", (event, context) => {
			recoveryEvent = event;
			recoveryContext = context;
		});
		const rawContext = {
			cwd: "/trusted-project",
			isProjectTrusted: () => true,
			sessionManager: {
				getEntries() {
					getEntriesCalls += 1;
					return [{ type: "message", secret: "must-not-leak" }];
				},
			},
			ui: { notify() {}, secretUiCapability() {} },
		};

		await rawHandler({ type: "session_start", reason, previousSessionFile: "/private/session.jsonl" }, rawContext);

		assert.deepEqual(recoveryEvent, { type: "session_start", reason });
		assert.deepEqual(Object.keys(recoveryContext), ["cwd", "reason", "ui", "isProjectTrusted", "readSessionSummary"]);
		assert.equal(Object.getPrototypeOf(recoveryContext), Object.prototype);
		assert.equal(Object.isFrozen(recoveryContext), true);
		assert.equal(Object.isFrozen(recoveryContext.ui), true);
		assert.deepEqual(Object.keys(recoveryContext.ui), ["notify"]);
		assert.equal(getEntriesCalls, 0);
		assert.deepEqual(recoveryContext.readSessionSummary(), { hasHistory: true });
		assert.equal(getEntriesCalls, 1);
		for (const key of ["raw", "api", "pi", "context", "sessionManager", "filesystem", "replaceManagedResources"]) {
			assert.equal(key in recoveryContext, false);
		}
	});
}

test("Recovery facade trust-gates dispatch and each lazy session summary read", async () => {
	const handlers = new Map();
	const commands = new Map();
	let trusted = false;
	let eventDispatches = 0;
	let commandDispatches = 0;
	let getEntriesCalls = 0;
	const ports = createPiExtensionPorts({
		on(name, handler) {
			handlers.set(name, handler);
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
		getAllTools: () => [],
		getThinkingLevel: () => "high",
		setThinkingLevel() {},
		setModel: async () => true,
	});
	ports.recovery.on("session_start", () => {
		eventDispatches += 1;
	});
	ports.recovery.registerCommand("project", {
		handler: async () => {
			commandDispatches += 1;
		},
	});
	const rawContext = {
		cwd: "/project",
		isProjectTrusted: () => trusted,
		sessionManager: {
			getEntries() {
				getEntriesCalls += 1;
				return [];
			},
		},
	};

	await handlers.get("session_start")({ type: "session_start", reason: "startup" }, rawContext);
	await commands.get("project").handler("status", rawContext);
	assert.equal(eventDispatches, 0);
	assert.equal(commandDispatches, 0);
	assert.equal(getEntriesCalls, 0);

	trusted = true;
	let recoveryContext;
	ports.recovery.on("session_shutdown", (_event, context) => {
		recoveryContext = context;
	});
	await handlers.get("session_shutdown")({ type: "session_shutdown" }, rawContext);
	trusted = false;
	assert.equal(recoveryContext.isProjectTrusted(), false);
	assert.equal(recoveryContext.readSessionSummary(), undefined);
	assert.equal(getEntriesCalls, 0);
});

test("Recovery facade registers no Pi behavior until a recovery factory uses it", () => {
	const registeredEvents = [];
	const registeredCommands = [];
	const ports = createPiExtensionPorts({
		on: (name) => registeredEvents.push(name),
		registerCommand: (name) => registeredCommands.push(name),
		getAllTools: () => [],
		getThinkingLevel: () => "high",
		setThinkingLevel() {},
		setModel: async () => true,
	});

	assert.equal(Object.isFrozen(ports.recovery), true);
	assert.equal(Object.getPrototypeOf(ports.recovery), Object.prototype);
	assert.throws(() => ports.recovery.on("agent_start", () => {}), /does not allow event/);
	assert.throws(() => ports.recovery.registerCommand("status", { handler: async () => {} }), /does not allow command/);
	assert.deepEqual(registeredEvents, []);
	assert.deepEqual(registeredCommands, []);
});

test("all BYZ extension factories mount through their assigned feature ports", () => {
	const commands = new Map();
	const handlers = new Map();
	const notifications = [];
	const pi = {
		on(name, handler) {
			const eventHandlers = handlers.get(name) ?? [];
			eventHandlers.push(handler);
			handlers.set(name, eventHandlers);
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
		getAllTools: () => [],
		getThinkingLevel: () => "high",
		setThinkingLevel() {},
		setModel: async () => true,
	};
	const ports = createPiExtensionPorts(pi);
	createDiagnosticsExtension({ mode: "print", recorder: { enabled: true, record() {} } })(ports.diagnostics);
	createWorkflowSwitchExtension({
		initialResources: { promptPaths: [], skillPaths: [] },
		initialWorkflowId: "none",
		resolveResources: async () => ({ promptPaths: [], skillPaths: [] }),
	})(ports.workflow);
	const fastController = createFastSessionController();
	fastController.extension(ports.fast);
	createPrewalkExtension({ fastController })(ports.prewalk);
	createConversationExtension()(ports.conversation);

	assert.deepEqual([...commands.keys()].sort(), ["details", "fast", "language", "prewalk", "workflow"]);
	assert.ok(handlers.get("session_start").length >= 2);
	assert.ok(handlers.get("tool_result").length === 1);
	assert.ok(handlers.get("resources_discover").length === 1);
	const context = {
		cwd: "/workspace",
		model: { provider: "provider", id: "model" },
		thinkingLevel: "high",
		sessionManager: { getCwd: () => "/workspace", getEntries: () => [] },
		getContextUsage: () => undefined,
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
			input: async () => undefined,
			setConfirmationPresenter() {},
			setFooter() {},
			setMessagePresenter() {},
			setTitle() {},
			setToolExecutionVisible() {},
			setWorkingMessage() {},
		},
	};
	for (const handler of handlers.get("session_start")) handler({ type: "session_start" }, context);
	assert.equal(
		notifications.some(({ message }) => message.startsWith("BYZ\n")),
		true,
	);
});

test("BYZ composition root injects one feature slice into each extension", async () => {
	const cli = await readFile(new URL("../src/cli.js", import.meta.url), "utf8");
	assert.doesNotMatch(cli, /createPiExtensionAdapter/);
	assert.match(cli, /diagnosticsFeature\(createPiExtensionPorts\(pi\)\.diagnostics\)/);
	assert.match(cli, /conversationExtension\(ports\.conversation\)/);
	assert.match(cli, /recoveryExtension\(ports\.recovery\)/);
	assert.ok(
		cli.indexOf("conversationExtension(ports.conversation)") < cli.indexOf("recoveryExtension(ports.recovery)"),
	);
	assert.match(cli, /workflowExtension\(ports\.workflow\)/);
	assert.match(cli, /fastController\.extension\(ports\.fast\)/);
	assert.match(cli, /prewalkExtension\(ports\.prewalk\)/);
});

test("Pi runtime adapter applies the BYZ product profile at the composition boundary", async () => {
	const calls = [];
	const adapter = createPiRuntimeAdapter(async (args, options) => calls.push({ args, options }), {
		showStartupHeader: false,
		showLoadedResources: false,
	});

	await adapter.run(["--print"], { extensionFactories: ["diagnostics"] });

	assert.deepEqual(calls, [
		{
			args: ["--print"],
			options: {
				extensionFactories: ["diagnostics"],
				productProfile: { showStartupHeader: false, showLoadedResources: false },
			},
		},
	]);
});

test("accepts domain and application code that depends only on local ports", () =>
	withFixture(async (root) => {
		await writeFile(join(root, "src", "application", "ports", "runtime.ts"), "export interface RuntimePort {}\n");
		await writeFile(
			join(root, "src", "application", "service.ts"),
			'import type { RuntimePort } from "./ports/runtime.ts";\nexport type Service = RuntimePort;\n',
		);
		await writeFile(
			join(root, "src", "domain", "project.ts"),
			'// import "node:fs"\nexport const example = \'import "@earendil-works/pi-ai"\';\nexport interface Project { id: string }\n',
		);

		assert.deepEqual(await checkArchitecture({ packageRoot: root }), []);
	}));

test("rejects transparent or legacy Pi adapters", () =>
	withFixture(async (root) => {
		await writeFile(
			join(root, "src", "adapters", "pi", "runtime.ts"),
			"export const adapt = (pi) => Proxy.revocable(pi, {});\n",
		);
		const violations = await checkArchitecture({ packageRoot: root });
		assert.deepEqual(violations, [
			{
				file: "src/adapters/pi/runtime.ts",
				specifier: "Proxy",
				reason: "transparent Pi capability",
			},
		]);
	}));

test("rejects public raw Pi escape properties from adapter facades", () =>
	withFixture(async (root) => {
		await writeFile(
			join(root, "src", "adapters", "pi", "runtime.ts"),
			"export const adapt = (pi) => ({ raw: pi });\n",
		);
		const violations = await checkArchitecture({ packageRoot: root });
		assert.deepEqual(violations, [
			{
				file: "src/adapters/pi/runtime.ts",
				specifier: "raw",
				reason: "raw Pi escape property",
			},
		]);
	}));

test("rejects raw Pi injection at the BYZ composition root", () =>
	withFixture(async (root) => {
		await writeFile(
			join(root, "src", "cli.js"),
			[
				"diagnosticsFeature(createPiExtensionPorts(pi).diagnostics);",
				"conversationExtension(pi);",
				"workflowExtension(ports.workflow);",
				"fastController.extension(ports.fast);",
				"prewalkExtension(ports.prewalk);",
			].join("\n"),
		);
		const violations = await checkArchitecture({ packageRoot: root });
		assert.deepEqual(violations, [
			{
				file: "src/cli.js",
				specifier: "conversationExtension(pi)",
				reason: "raw or incorrect feature capability composition",
			},
		]);
	}));

test("rejects Pi, adapter, filesystem, and SQLite imports from protected layers", () =>
	withFixture(async (root) => {
		await writeFile(
			join(root, "src", "application", "bad.ts"),
			[
				'import { main } from "@earendil-works/pi-coding-agent";',
				'import { stream } from "@earendil-works/pi-ai";',
				'import { adapter } from "../adapters/pi/runtime.ts";',
				'import { sibling } from "../../../coding-agent/src/main.ts";',
				'import { readFile } from /* legal comment */ "fs/promises";',
				'import sqlite from "better-sqlite3";',
				'const lazyFs = import("node:fs");',
				'const hiddenFs = import("node:" + "fs");',
			].join("\n"),
		);

		const violations = await checkArchitecture({ packageRoot: root });
		assert.equal(violations.length, 8);
		assert.deepEqual(
			violations.map((violation) => violation.reason).sort(),
			[
				"Node filesystem implementation",
				"Node filesystem implementation",
				"Pi/runtime implementation package",
				"Pi/runtime implementation package",
				"SQLite implementation",
				"adapter implementation",
				"dynamic implementation import",
				"external implementation",
			].sort(),
		);
	}));
