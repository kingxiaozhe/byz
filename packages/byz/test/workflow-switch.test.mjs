import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "../dist/runtime/bundle/index.js";
import {
	createWorkflowSwitchExtension,
	shouldEnableWorkflowSwitch,
	shouldLoadWorkflow,
} from "../dist/workflow-switch.js";

function createExtensionHarness(options) {
	const handlers = new Map();
	const commands = new Map();
	const extension = createWorkflowSwitchExtension(options);
	extension({
		on(event, handler) {
			handlers.set(event, handler);
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
	});
	return { commands, handlers };
}

function createCommandContext({ idle = true, updateError } = {}) {
	const notifications = [];
	const resourceUpdates = [];
	return {
		context: {
			isIdle: () => (typeof idle === "function" ? idle() : idle),
			replaceByzWorkflowResources: async (resources) => {
				if (updateError) throw updateError;
				resourceUpdates.push(resources);
			},
			ui: {
				notify(message, type) {
					notifications.push({ message, type });
				},
			},
		},
		notifications,
		resourceUpdates,
	};
}

test("switches workflow resources in place without a model turn", async () => {
	const resolved = [];
	const harness = createExtensionHarness({
		initialWorkflowId: "cm",
		initialResources: { promptPaths: ["/cm/prompts"], skillPaths: ["/cm/skills"] },
		resolveResources: async (workflowId) => {
			resolved.push(workflowId);
			if (workflowId === "none") return { promptPaths: [], skillPaths: [] };
			return { promptPaths: [`/${workflowId}/prompts`], skillPaths: [`/${workflowId}/skills`] };
		},
	});
	const command = harness.commands.get("workflow");
	const discover = harness.handlers.get("resources_discover");
	const ctx = createCommandContext();

	assert.deepEqual(await discover(), { promptPaths: ["/cm/prompts"], skillPaths: ["/cm/skills"] });
	await command.handler("cm-plugin", ctx.context);
	assert.deepEqual(ctx.resourceUpdates, [{ promptPaths: ["/cm-plugin/prompts"], skillPaths: ["/cm-plugin/skills"] }]);
	assert.deepEqual(resolved, ["cm-plugin"]);
	assert.deepEqual(await discover(), {
		promptPaths: ["/cm-plugin/prompts"],
		skillPaths: ["/cm-plugin/skills"],
	});

	await command.handler("none", ctx.context);
	assert.deepEqual(ctx.resourceUpdates.at(-1), { promptPaths: [], skillPaths: [] });
	assert.deepEqual(await discover(), { promptPaths: [], skillPaths: [] });
});

test("switches resources without reloading unrelated extensions or changing the conversation", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-workflow-session-"));
	let session;
	let sessionStarts = 0;
	let sessionShutdowns = 0;
	let unrelatedUpdateError;
	const agentDir = join(root, "agent");
	const cmSkill = join(root, "cm", "skills", "cm-ai");
	const pluginSkill = join(root, "cm-plugin", "skills", "cm-plugin-ai");
	const hostSkill = join(root, "host", "skills", "host-skill");
	await Promise.all([
		mkdir(agentDir, { recursive: true }),
		mkdir(cmSkill, { recursive: true }),
		mkdir(pluginSkill, { recursive: true }),
		mkdir(hostSkill, { recursive: true }),
	]);
	await Promise.all([
		writeFile(join(cmSkill, "SKILL.md"), "---\nname: cm-ai\ndescription: CM\n---\nCM\n"),
		writeFile(join(pluginSkill, "SKILL.md"), "---\nname: cm-plugin-ai\ndescription: CM Plugin\n---\nCM Plugin\n"),
		writeFile(join(hostSkill, "SKILL.md"), "---\nname: host-skill\ndescription: Host\n---\nHost\n"),
	]);

	try {
		const resolveResources = async (workflowId) => ({
			promptPaths: [],
			skillPaths: workflowId === "none" ? [] : [join(root, workflowId === "cm" ? "cm" : "cm-plugin", "skills")],
		});
		const workflowExtension = createWorkflowSwitchExtension({
			initialResources: await resolveResources("none"),
			initialWorkflowId: "none",
			resolveResources,
		});
		const unrelatedExtension = (pi) => {
			pi.on("resources_discover", () => ({ skillPaths: [join(root, "host", "skills")] }));
			pi.on("session_start", () => {
				sessionStarts++;
			});
			pi.on("session_shutdown", () => {
				sessionShutdowns++;
			});
			pi.registerCommand("unrelated-update", {
				handler: async (_args, ctx) => {
					unrelatedUpdateError = new Error(
						typeof ctx.replaceByzWorkflowResources === "function"
							? "unrelated extension received BYZ resource access"
							: "BYZ resource access is unavailable",
					);
				},
			});
		};
		const settingsManager = SettingsManager.inMemory();
		const services = await createAgentSessionServices({
			agentDir,
			cwd: root,
			settingsManager,
			resourceLoaderOptions: {
				byzWorkflowExtensionFactory: workflowExtension,
				// A caller-supplied display name must not grant the dedicated BYZ capability.
				extensionFactories: [{ factory: unrelatedExtension, name: "byz-workflow" }],
				noPromptTemplates: true,
				noThemes: true,
			},
		});
		({ session } = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(),
		}));
		const cancelled = async () => ({ cancelled: true });
		await session.bindExtensions({
			commandContextActions: {
				fork: cancelled,
				navigateTree: cancelled,
				newSession: cancelled,
				reload: async () => {
					throw new Error("full reload must not be used for workflow switching");
				},
				switchSession: cancelled,
				waitForIdle: () => session.waitForIdle(),
			},
			mode: "tui",
		});
		const initialRunner = session.extensionRunner;
		session.agent.state.messages = [{ role: "user", content: "existing conversation", timestamp: Date.now() }];

		const initialSkillNames = services.resourceLoader.getSkills().skills.map((skill) => skill.name);
		assert.ok(initialSkillNames.includes("host-skill"));
		assert.ok(!initialSkillNames.includes("cm-ai"));
		assert.ok(!initialSkillNames.includes("cm-plugin-ai"));
		await session.prompt("/workflow cm");
		const cmSkillNames = services.resourceLoader.getSkills().skills.map((skill) => skill.name);
		assert.ok(cmSkillNames.includes("cm-ai"));
		assert.ok(cmSkillNames.includes("host-skill"));
		assert.ok(!cmSkillNames.includes("cm-plugin-ai"));
		await session.prompt("/workflow cm-plugin");

		const switchedSkillNames = services.resourceLoader.getSkills().skills.map((skill) => skill.name);
		assert.ok(switchedSkillNames.includes("cm-plugin-ai"));
		assert.ok(switchedSkillNames.includes("host-skill"));
		assert.ok(!switchedSkillNames.includes("cm-ai"));
		await session.prompt("/workflow none");
		assert.deepEqual(
			services.resourceLoader.getSkills().skills.map((skill) => skill.name),
			initialSkillNames,
		);
		await session.prompt("/unrelated-update");
		assert.equal(unrelatedUpdateError?.message, "BYZ resource access is unavailable");
		assert.deepEqual(
			services.resourceLoader.getSkills().skills.map((skill) => skill.name),
			initialSkillNames,
		);
		assert.equal(session.extensionRunner, initialRunner);
		assert.equal(sessionStarts, 1);
		assert.equal(sessionShutdowns, 0);
		assert.equal(session.messages.length, 1);
		assert.equal(session.messages[0].role, "user");
	} finally {
		session?.dispose();
		await rm(root, { force: true, recursive: true });
	}
});

test("reports current workflow and treats the active target as a no-op", async () => {
	const harness = createExtensionHarness({
		initialWorkflowId: "cm",
		initialResources: { promptPaths: [], skillPaths: [] },
		resolveResources: async () => {
			throw new Error("same workflow must not be resolved again");
		},
	});
	const command = harness.commands.get("workflow");
	const ctx = createCommandContext();

	await command.handler("", ctx.context);
	await command.handler(" cm ", ctx.context);

	assert.equal(ctx.resourceUpdates.length, 0);
	assert.deepEqual(ctx.notifications, [
		{ message: "BYZ workflow: cm", type: "info" },
		{ message: "BYZ workflow is already cm.", type: "info" },
	]);
});

test("rejects a workflow switch while the agent is busy", async () => {
	let resolutions = 0;
	const harness = createExtensionHarness({
		initialWorkflowId: "cm",
		initialResources: { promptPaths: ["/cm/prompts"], skillPaths: ["/cm/skills"] },
		resolveResources: async () => {
			resolutions++;
			return { promptPaths: [], skillPaths: [] };
		},
	});
	const ctx = createCommandContext({ idle: false });

	await harness.commands.get("workflow").handler("cm-plugin", ctx.context);

	assert.equal(resolutions, 0);
	assert.equal(ctx.resourceUpdates.length, 0);
	assert.deepEqual(ctx.notifications, [
		{ message: "BYZ cannot switch workflows while the agent is running.", type: "warning" },
	]);
});

test("keeps the active workflow when the scoped resource update fails", async () => {
	const harness = createExtensionHarness({
		initialWorkflowId: "cm",
		initialResources: { promptPaths: ["/cm/prompts"], skillPaths: ["/cm/skills"] },
		resolveResources: async () => ({
			promptPaths: ["/cm-plugin/prompts"],
			skillPaths: ["/cm-plugin/skills"],
		}),
	});
	const ctx = createCommandContext({ updateError: new Error("resource update failed") });

	await harness.commands.get("workflow").handler("cm-plugin", ctx.context);

	assert.deepEqual(await harness.handlers.get("resources_discover")(), {
		promptPaths: ["/cm/prompts"],
		skillPaths: ["/cm/skills"],
	});
	assert.deepEqual(ctx.notifications.at(-1), {
		message: "BYZ workflow switch failed: resource update failed",
		type: "error",
	});
});

test("rejects a workflow switch if the agent becomes busy during validation", async () => {
	let idle = true;
	const harness = createExtensionHarness({
		initialWorkflowId: "cm",
		initialResources: { promptPaths: ["/cm/prompts"], skillPaths: ["/cm/skills"] },
		resolveResources: async () => {
			idle = false;
			return { promptPaths: ["/cm-plugin/prompts"], skillPaths: ["/cm-plugin/skills"] };
		},
	});
	const ctx = createCommandContext({ idle: () => idle });

	await harness.commands.get("workflow").handler("cm-plugin", ctx.context);

	assert.equal(ctx.resourceUpdates.length, 0);
	assert.deepEqual(await harness.handlers.get("resources_discover")(), {
		promptPaths: ["/cm/prompts"],
		skillPaths: ["/cm/skills"],
	});
	assert.deepEqual(ctx.notifications.at(-1), {
		message: "BYZ cannot switch workflows while the agent is running.",
		type: "warning",
	});
});

test("keeps the active workflow when target validation fails", async () => {
	const harness = createExtensionHarness({
		initialWorkflowId: "cm",
		initialResources: { promptPaths: ["/cm/prompts"], skillPaths: ["/cm/skills"] },
		resolveResources: async () => {
			throw new Error("CM Plugin Workflow is incomplete.");
		},
	});
	const ctx = createCommandContext();

	await harness.commands.get("workflow").handler("cm-plugin", ctx.context);

	assert.equal(ctx.resourceUpdates.length, 0);
	assert.deepEqual(await harness.handlers.get("resources_discover")(), {
		promptPaths: ["/cm/prompts"],
		skillPaths: ["/cm/skills"],
	});
	assert.deepEqual(ctx.notifications, [{ message: "CM Plugin Workflow is incomplete.", type: "error" }]);
});

test("rejects unknown workflow command arguments", async () => {
	const harness = createExtensionHarness({
		initialWorkflowId: "cm",
		initialResources: { promptPaths: [], skillPaths: [] },
		resolveResources: async () => ({ promptPaths: [], skillPaths: [] }),
	});
	const ctx = createCommandContext();

	await harness.commands.get("workflow").handler("other", ctx.context);

	assert.equal(ctx.resourceUpdates.length, 0);
	assert.deepEqual(ctx.notifications, [{ message: "Usage: /workflow [cm|cm-plugin|none]", type: "error" }]);
});

test("enables workflow switching only for Pi interactive modes", () => {
	const tty = { stdinIsTTY: true, stdoutIsTTY: true };
	assert.equal(shouldEnableWorkflowSwitch([], tty), true);
	assert.equal(shouldEnableWorkflowSwitch(["--mode", "text"], tty), true);
	assert.equal(shouldEnableWorkflowSwitch(["--mode", "json"], tty), false);
	assert.equal(shouldEnableWorkflowSwitch(["--mode", "rpc", "--mode", "bogus"], tty), false);
	assert.equal(shouldEnableWorkflowSwitch(["--mode", "bogus", "--mode", "text"], tty), true);
	assert.equal(shouldEnableWorkflowSwitch(["--mode", "--print"], tty), true);
	assert.equal(shouldEnableWorkflowSwitch(["--mode", "json", "--mode", "--print"], tty), false);
	assert.equal(shouldEnableWorkflowSwitch(["--print"], tty), false);
	assert.equal(shouldEnableWorkflowSwitch([], { stdinIsTTY: false, stdoutIsTTY: true }), false);
	assert.equal(shouldEnableWorkflowSwitch([], { stdinIsTTY: true, stdoutIsTTY: false }), false);
});

test("uses Pi argument parsing when deciding whether workflow resources are needed", () => {
	assert.equal(shouldLoadWorkflow(["--help"]), false);
	assert.equal(shouldLoadWorkflow(["--export", "session.jsonl"]), false);
	assert.equal(shouldLoadWorkflow(["--list-models"]), false);
	assert.equal(shouldLoadWorkflow(["update"]), false);
	assert.equal(shouldLoadWorkflow(["--mode", "--help"]), true);
	assert.equal(shouldLoadWorkflow(["--mode", "--export"]), true);
	assert.equal(shouldLoadWorkflow(["--mode", "--list-models"]), true);
});

test("BYZ dynamic workflow resources win collisions without hiding unrelated host resources", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-workflow-precedence-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	const hostCollision = join(agentDir, "skills", "cm-ai");
	const hostUnrelated = join(agentDir, "skills", "host-only");
	const workflowCollision = join(root, "workflow", "skills", "cm-ai");
	const extensionUnrelated = join(root, "extension", "skills", "extension-only");
	const hostPrompts = join(agentDir, "prompts");
	const workflowPrompts = join(root, "workflow", "prompts");
	const extensionPrompts = join(root, "extension", "prompts");
	await Promise.all([
		mkdir(hostCollision, { recursive: true }),
		mkdir(hostUnrelated, { recursive: true }),
		mkdir(workflowCollision, { recursive: true }),
		mkdir(extensionUnrelated, { recursive: true }),
		mkdir(hostPrompts, { recursive: true }),
		mkdir(workflowPrompts, { recursive: true }),
		mkdir(extensionPrompts, { recursive: true }),
		mkdir(cwd, { recursive: true }),
	]);
	await Promise.all([
		writeFile(join(hostCollision, "SKILL.md"), "---\nname: cm-ai\ndescription: host\n---\nhost\n"),
		writeFile(join(hostUnrelated, "SKILL.md"), "---\nname: host-only\ndescription: host\n---\nhost\n"),
		writeFile(join(workflowCollision, "SKILL.md"), "---\nname: cm-ai\ndescription: bundled\n---\nbundled\n"),
		writeFile(
			join(extensionUnrelated, "SKILL.md"),
			"---\nname: extension-only\ndescription: extension\n---\nextension\n",
		),
		writeFile(join(hostPrompts, "cm-check.md"), "host prompt\n"),
		writeFile(join(workflowPrompts, "cm-check.md"), "bundled prompt\n"),
		writeFile(join(extensionPrompts, "extension-only.md"), "extension prompt\n"),
	]);

	try {
		let themeOverrideCalls = 0;
		const loader = new DefaultResourceLoader({
			agentDir,
			cwd,
			themesOverride: (themes) => {
				themeOverrideCalls++;
				return themes;
			},
		});
		await loader.reload();
		const themeOverrideCallsAfterReload = themeOverrideCalls;
		const workflowOwner = "owner:byz-workflow";
		const unrelatedOwner = "owner:host-extra";
		const metadata = {
			origin: "top-level",
			scope: "temporary",
			source: "extension:inline:byz-workflow",
		};
		const unrelatedMetadata = {
			origin: "top-level",
			scope: "temporary",
			source: "extension:host-extra",
		};
		loader.registerByzWorkflowResourceOwner(workflowOwner);
		loader.extendResources({
			promptPaths: [
				{ metadata, owner: workflowOwner, path: workflowPrompts },
				{ metadata: unrelatedMetadata, owner: unrelatedOwner, path: extensionPrompts },
			],
			skillPaths: [
				{ metadata, owner: workflowOwner, path: workflowCollision },
				{ metadata: unrelatedMetadata, owner: unrelatedOwner, path: extensionUnrelated },
			],
		});

		assert.equal(
			loader.getSkills().skills.find((skill) => skill.name === "cm-ai")?.filePath,
			join(workflowCollision, "SKILL.md"),
		);
		assert.ok(loader.getSkills().skills.some((skill) => skill.name === "host-only"));
		assert.ok(loader.getSkills().skills.some((skill) => skill.name === "extension-only"));
		assert.equal(
			loader.getPrompts().prompts.find((prompt) => prompt.name === "cm-check")?.filePath,
			join(workflowPrompts, "cm-check.md"),
		);
		assert.ok(loader.getPrompts().prompts.some((prompt) => prompt.name === "extension-only"));

		await writeFile(
			join(hostUnrelated, "SKILL.md"),
			"---\nname: host-only\ndescription: changed on disk\n---\nchanged\n",
		);
		loader.replaceByzWorkflowResources(workflowOwner, {});
		assert.equal(
			loader.getSkills().skills.find((skill) => skill.name === "cm-ai")?.filePath,
			join(hostCollision, "SKILL.md"),
		);
		assert.equal(
			loader.getPrompts().prompts.find((prompt) => prompt.name === "cm-check")?.filePath,
			join(hostPrompts, "cm-check.md"),
		);
		assert.ok(loader.getSkills().skills.some((skill) => skill.name === "extension-only"));
		assert.equal(loader.getSkills().skills.find((skill) => skill.name === "host-only")?.description, "host");
		assert.equal(themeOverrideCalls, themeOverrideCallsAfterReload);

		loader.replaceByzWorkflowResources(workflowOwner, {
			promptPaths: [{ metadata, owner: workflowOwner, path: workflowPrompts }],
			skillPaths: [{ metadata, owner: workflowOwner, path: workflowCollision }],
		});
		assert.equal(
			loader.getSkills().skills.find((skill) => skill.name === "cm-ai")?.filePath,
			join(workflowCollision, "SKILL.md"),
		);
		assert.equal(
			loader.getPrompts().prompts.find((prompt) => prompt.name === "cm-check")?.filePath,
			join(workflowPrompts, "cm-check.md"),
		);
		assert.equal(themeOverrideCalls, themeOverrideCallsAfterReload);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test("scoped replacement separates owners that share the same display source", async () => {
	const root = await mkdtemp(join(tmpdir(), "byz-workflow-owner-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	const firstSkill = join(root, "first", "skills", "first-skill");
	const secondSkill = join(root, "second", "skills", "second-skill");
	await Promise.all([
		mkdir(agentDir, { recursive: true }),
		mkdir(cwd, { recursive: true }),
		mkdir(firstSkill, { recursive: true }),
		mkdir(secondSkill, { recursive: true }),
	]);
	await Promise.all([
		writeFile(join(firstSkill, "SKILL.md"), "---\nname: first-skill\ndescription: first\n---\nfirst\n"),
		writeFile(join(secondSkill, "SKILL.md"), "---\nname: second-skill\ndescription: second\n---\nsecond\n"),
	]);

	try {
		const loader = new DefaultResourceLoader({ agentDir, cwd });
		await loader.reload();
		const metadata = {
			origin: "top-level",
			scope: "temporary",
			source: "extension:inline:byz-workflow",
		};
		loader.registerByzWorkflowResourceOwner("owner:first");
		loader.extendResources({
			skillPaths: [
				{ metadata, owner: "owner:first", path: firstSkill },
				{ metadata, owner: "owner:second", path: secondSkill },
			],
		});

		loader.replaceByzWorkflowResources("owner:first", {});

		assert.ok(!loader.getSkills().skills.some((skill) => skill.name === "first-skill"));
		assert.ok(loader.getSkills().skills.some((skill) => skill.name === "second-skill"));
		assert.throws(
			() => loader.replaceByzWorkflowResources("owner:second", {}),
			/updates are reserved for the active BYZ workflow/,
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});
