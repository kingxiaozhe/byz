import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { gt, valid } from "semver";
import { createCommandOutput, createPassthroughResult, resultFromOutput } from "./application/command-result.js";
import { runUpdateWithDiagnostics } from "./diagnostics/update-integration.js";
import { getSelfUpdateCommand, getSelfUpdateManualCommand, VERSION } from "./runtime/bundle/index.js";

export const BYZ_PACKAGE_NAME = "@aibyzero/byz";
const BYZ_LATEST_URL = "https://registry.npmjs.org/@aibyzero%2fbyz/latest";
const BYZ_NPM_REGISTRY_ARG = "--@aibyzero:registry=https://registry.npmjs.org/";
const UPDATE_TIMEOUT_MS = 10_000;
const MAX_UPDATE_OUTPUT_BYTES = 256 * 1024;
const UPDATE_TERMINATE_GRACE_MS = 1_000;
const UPDATE_FORCE_KILL_GRACE_MS = 1_000;

class UpdateCommandFailure extends Error {
	result;

	constructor(message, result) {
		super(message);
		this.name = "UpdateCommandFailure";
		this.result = result;
	}
}

export async function getLatestByzRelease(currentVersion, options = {}) {
	const fetchRelease = options.fetch ?? globalThis.fetch;
	const signal = options.signal ?? AbortSignal.timeout(UPDATE_TIMEOUT_MS);
	const response = await fetchRelease(BYZ_LATEST_URL, {
		headers: {
			accept: "application/json",
			"User-Agent": `byz/${currentVersion}`,
		},
		redirect: "error",
		signal,
	});
	if (!response.ok) {
		throw new Error(`Could not determine latest BYZ version (HTTP ${response.status}).`);
	}
	const data = await response.json();
	if (data?.name !== BYZ_PACKAGE_NAME || typeof data.version !== "string" || valid(data.version) !== data.version) {
		throw new Error("The npm registry returned invalid BYZ release metadata.");
	}
	return { name: BYZ_PACKAGE_NAME, version: data.version };
}

export function planByzUpdate(currentVersion, latestVersion, options = {}) {
	if (valid(currentVersion) !== currentVersion || valid(latestVersion) !== latestVersion) {
		throw new Error("BYZ update metadata contains an invalid semantic version.");
	}
	if (gt(currentVersion, latestVersion)) return { action: "ahead", version: latestVersion };
	if (!options.force && !gt(latestVersion, currentVersion)) return { action: "current", version: latestVersion };
	return { action: "update", version: latestVersion };
}

function splitOutputLines(value) {
	if (!value) return [];
	const lines = value.replaceAll("\r\n", "\n").split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

function appendProcessOutput(output, result) {
	for (const line of result?.stdout ?? []) output.writeStdout(line);
	for (const line of result?.stderr ?? []) output.writeStderr(line);
}

function normalizeCliExitCode(code) {
	return Number.isSafeInteger(code) && code > 0 && code <= 255 ? code : 1;
}

function resolveSpawnInvocation(step, options) {
	if ((options.platform ?? process.platform) !== "win32" || step.command !== "npm") return step;
	const nodeExecutable = options.nodeExecutable ?? process.execPath;
	const npmCliPath = options.npmCliPath ?? join(dirname(nodeExecutable), "node_modules", "npm", "bin", "npm-cli.js");
	return { ...step, command: nodeExecutable, args: [npmCliPath, ...step.args] };
}

export async function runSelfUpdateCommand(command, spawnProcess = spawn, options = {}) {
	const maxOutputBytes = options.maxOutputBytes ?? MAX_UPDATE_OUTPUT_BYTES;
	const terminateGraceMs = options.terminateGraceMs ?? UPDATE_TERMINATE_GRACE_MS;
	const forceKillGraceMs = options.forceKillGraceMs ?? UPDATE_FORCE_KILL_GRACE_MS;
	for (const [name, value] of Object.entries({ maxOutputBytes, terminateGraceMs, forceKillGraceMs })) {
		if (!Number.isSafeInteger(value) || value < 0 || (name === "maxOutputBytes" && value === 0)) {
			throw new Error(`Invalid update process option: ${name}.`);
		}
	}

	const result = { exitCode: 0, stdout: [], stderr: [] };
	try {
		for (const step of command.steps ?? [command]) {
			const stepResult = await new Promise((resolveRun, rejectRun) => {
				let child;
				try {
					const invocation = resolveSpawnInvocation(step, options);
					child = spawnProcess(invocation.command, invocation.args, {
						shell: false,
						stdio: ["inherit", "pipe", "pipe"],
					});
				} catch (error) {
					rejectRun(
						new UpdateCommandFailure(error instanceof Error ? error.message : String(error), {
							exitCode: 1,
							stdout: [],
							stderr: [error instanceof Error ? error.message : String(error)],
						}),
					);
					return;
				}

				let settled = false;
				let stdout = "";
				let stderr = "";
				let stdoutBytes = 0;
				let stderrBytes = 0;
				let overflowStream;
				let terminateTimer;
				let forceKillTimer;
				let terminationIssue = "";

				const clearTerminationTimers = () => {
					if (terminateTimer) clearTimeout(terminateTimer);
					if (forceKillTimer) clearTimeout(forceKillTimer);
				};
				const detachChild = () => {
					child.stdout?.removeAllListeners("data");
					child.stderr?.removeAllListeners("data");
					child.stdout?.destroy();
					child.stderr?.destroy();
					child.removeAllListeners("close");
					child.removeAllListeners("error");
					child.on("error", () => {});
					child.unref?.();
				};
				const fail = (message, exitCode = 1, detach = false) => {
					if (settled) return;
					settled = true;
					clearTerminationTimers();
					if (detach) detachChild();
					rejectRun(
						new UpdateCommandFailure(message, {
							exitCode,
							stdout: splitOutputLines(stdout),
							stderr: [...splitOutputLines(stderr), message],
						}),
					);
				};
				const overflowMessage = () => `BYZ update ${overflowStream} exceeded the ${maxOutputBytes}-byte limit.`;
				const forceKill = () => {
					if (settled) return;
					try {
						if (child.kill("SIGKILL") === false) terminationIssue = " Force termination was not accepted.";
					} catch {
						terminationIssue = " Force termination failed.";
					}
					if (!settled) {
						forceKillTimer = setTimeout(
							() =>
								fail(
									`${overflowMessage()} The update process did not close after forced termination.${terminationIssue}`,
									1,
									true,
								),
							forceKillGraceMs,
						);
					}
				};
				const beginOverflowTermination = (streamName) => {
					if (overflowStream || settled) return;
					overflowStream = streamName;
					let terminateImmediately = false;
					try {
						terminateImmediately = child.kill("SIGTERM") === false;
					} catch {
						terminateImmediately = true;
					}
					if (!settled) terminateTimer = setTimeout(forceKill, terminateImmediately ? 0 : terminateGraceMs);
				};
				const capture = (stream, streamName) => {
					stream?.setEncoding("utf8");
					stream?.on("data", (chunk) => {
						if (overflowStream || settled) return;
						const bytes = Buffer.byteLength(chunk);
						if ((streamName === "stdout" ? stdoutBytes : stderrBytes) + bytes > maxOutputBytes) {
							beginOverflowTermination(streamName);
							return;
						}
						if (streamName === "stdout") {
							stdout += chunk;
							stdoutBytes += bytes;
						} else {
							stderr += chunk;
							stderrBytes += bytes;
						}
					});
				};
				capture(child.stdout, "stdout");
				capture(child.stderr, "stderr");

				child.on("error", (error) => {
					const message = error instanceof Error ? error.message : String(error);
					if (overflowStream) {
						terminationIssue = " Termination emitted an error.";
						return;
					}
					fail(message);
				});
				child.once("close", (code, signal) => {
					if (overflowStream) fail(overflowMessage());
					else if (code === 0) {
						if (settled) return;
						settled = true;
						clearTerminationTimers();
						resolveRun({ exitCode: 0, stdout: splitOutputLines(stdout), stderr: splitOutputLines(stderr) });
					} else if (signal) fail(`${step.display} terminated by signal ${signal}.`);
					else fail(`${step.display} exited with code ${code ?? "unknown"}.`, normalizeCliExitCode(code));
				});
			});
			result.stdout.push(...stepResult.stdout);
			result.stderr.push(...stepResult.stderr);
		}
		return result;
	} catch (error) {
		if (error instanceof UpdateCommandFailure) {
			error.result.stdout.unshift(...result.stdout);
			error.result.stderr.unshift(...result.stderr);
		}
		throw error;
	}
}

function formatCommand(command, args) {
	return [command, ...args].map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ");
}

export function getByzUpdateCommand(installSpec, getUpdateCommand = getSelfUpdateCommand) {
	const command = getUpdateCommand(BYZ_PACKAGE_NAME, undefined, {
		packageName: BYZ_PACKAGE_NAME,
		installSpec,
	});
	if (!command || command.command !== "npm" || command.steps?.some((step) => step.command !== "npm")) {
		return undefined;
	}
	const secureStep = (step) => {
		const args = [BYZ_NPM_REGISTRY_ARG, ...step.args];
		return { ...step, args, display: formatCommand(step.command, args) };
	};
	const secured = secureStep(command);
	if (!command.steps) return secured;
	const steps = command.steps.map(secureStep);
	return { ...secured, display: steps.map((step) => step.display).join(" && "), steps };
}

export function getByzManualUpdateCommand(installSpec, getUpdateCommand = getSelfUpdateManualCommand) {
	return getByzUpdateCommand(installSpec, getUpdateCommand);
}

export async function handleByzUpdate(args, dependencies = {}) {
	if (args[0] !== "update") return createPassthroughResult();
	const options = args.slice(1);
	const output = createCommandOutput();
	const stderr = output.writeStderr;
	const stdout = output.writeStdout;
	if (options.includes("--help") || options.includes("-h")) {
		stdout("Usage: byz update [--force]");
		stdout("Updates only an npm-managed global @aibyzero/byz installation.");
		return resultFromOutput(output);
	}
	const invalid = options.filter((option) => option !== "--force");
	if (invalid.length > 0 || options.filter((option) => option === "--force").length > 1) {
		stderr("Invalid BYZ update arguments. Expected only --force or --help.");
		output.exitCode = 1;
		return resultFromOutput(output);
	}

	const currentVersion = dependencies.currentVersion ?? VERSION;
	const getLatestRelease = dependencies.getLatestRelease ?? getLatestByzRelease;
	const latest = await getLatestRelease(currentVersion);
	if (latest.name !== BYZ_PACKAGE_NAME) {
		throw new Error("The release source attempted to substitute the BYZ package identity.");
	}
	const plan = planByzUpdate(currentVersion, latest.version, { force: options.includes("--force") });
	if (plan.action === "current") {
		stdout(`BYZ is already up to date (v${currentVersion}).`);
		return resultFromOutput(output);
	}
	if (plan.action === "ahead") {
		stdout(
			`BYZ v${currentVersion} is newer than the latest published version v${plan.version}; no downgrade performed.`,
		);
		return resultFromOutput(output);
	}

	const installSpec = `${BYZ_PACKAGE_NAME}@${plan.version}`;
	const command = getByzUpdateCommand(installSpec, dependencies.getUpdateCommand);
	if (!command) {
		const manualCommand = getByzManualUpdateCommand(installSpec, dependencies.getManualUpdateCommand);
		stderr("BYZ can update only a writable npm-managed global installation.");
		stderr(
			manualCommand
				? `Update this installation manually with: ${manualCommand.display}`
				: "Update BYZ with the package manager, wrapper, or source checkout that provides this installation.",
		);
		output.exitCode = 2;
		return resultFromOutput(output);
	}

	stdout(`Updating BYZ with ${command.display}...`);
	try {
		const commandOutput = await runUpdateWithDiagnostics({
			command,
			diagnostics: dependencies.diagnostics,
			fromVersion: currentVersion,
			identity: `node-${process.versions.node.split(".")[0]}-${process.platform}`,
			runCommand:
				dependencies.runCommand ??
				((updateCommand) =>
					runSelfUpdateCommand(updateCommand, dependencies.spawnProcess, dependencies.updateProcessOptions)),
			toVersion: plan.version,
		});
		appendProcessOutput(output, commandOutput);
	} catch (error) {
		if (error instanceof UpdateCommandFailure) {
			appendProcessOutput(output, error.result);
			output.exitCode = error.result.exitCode;
		} else {
			output.writeStderr(error instanceof Error ? error.message : String(error));
			output.exitCode = 1;
		}
		return resultFromOutput(output);
	}
	stdout(`Updated BYZ from ${currentVersion} to ${plan.version}. Restart BYZ to use the new version.`);
	return resultFromOutput(output);
}
