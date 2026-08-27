import { spawn } from "node:child_process";
import { gt, valid } from "semver";
import { getSelfUpdateCommand, getSelfUpdateManualCommand, VERSION } from "./runtime/bundle/index.js";

export const BYZ_PACKAGE_NAME = "@aibyzero/byz";
const BYZ_LATEST_URL = "https://registry.npmjs.org/@aibyzero%2fbyz/latest";
const BYZ_NPM_REGISTRY_ARG = "--@aibyzero:registry=https://registry.npmjs.org/";
const UPDATE_TIMEOUT_MS = 10_000;

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

async function runSelfUpdateCommand(command, spawnProcess = spawn) {
	for (const step of command.steps ?? [command]) {
		await new Promise((resolveRun, rejectRun) => {
			const child = spawnProcess(step.command, step.args, { shell: false, stdio: "inherit" });
			child.once("error", rejectRun);
			child.once("close", (code, signal) => {
				if (code === 0) resolveRun();
				else if (signal) rejectRun(new Error(`${step.display} terminated by signal ${signal}.`));
				else rejectRun(new Error(`${step.display} exited with code ${code ?? "unknown"}.`));
			});
		});
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
	if (args[0] !== "update") return false;
	const options = args.slice(1);
	const stderr = dependencies.stderr ?? console.error;
	const stdout = dependencies.stdout ?? console.log;
	if (options.includes("--help") || options.includes("-h")) {
		stdout("Usage: byz update [--force]");
		stdout("Updates only an npm-managed global @aibyzero/byz installation.");
		return true;
	}
	const invalid = options.filter((option) => option !== "--force");
	if (invalid.length > 0 || options.filter((option) => option === "--force").length > 1) {
		stderr("Invalid BYZ update arguments. Expected only --force or --help.");
		process.exitCode = 1;
		return true;
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
		return true;
	}
	if (plan.action === "ahead") {
		stdout(
			`BYZ v${currentVersion} is newer than the latest published version v${plan.version}; no downgrade performed.`,
		);
		return true;
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
		process.exitCode = 2;
		return true;
	}

	stdout(`Updating BYZ with ${command.display}...`);
	const runCommand = dependencies.runCommand ?? runSelfUpdateCommand;
	await runCommand(command);
	stdout(`Updated BYZ from ${currentVersion} to ${plan.version}. Restart BYZ to use the new version.`);
	return true;
}
