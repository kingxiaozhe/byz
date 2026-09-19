#!/usr/bin/env node

/**
 * Bumps only the lockstep workspace packages. Independently released packages keep their own
 * version line and are left untouched, so a Pi release never moves them.
 *
 * Usage: node scripts/version-lockstep.mjs [npm flags...] <major|minor|patch|x.y.z>
 * The first non-flag argument is the version target; every flag is forwarded to `npm version`.
 */

import { spawnSync } from "node:child_process";
import { INDEPENDENT_PACKAGES } from "./package-workspaces.mjs";

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function parseArguments(argv) {
	const flags = argv.filter((argument) => argument.startsWith("-"));
	const targets = argv.filter((argument) => !argument.startsWith("-"));
	if (targets.length !== 1) {
		console.error("Usage: node scripts/version-lockstep.mjs [npm flags...] <major|minor|patch|x.y.z>");
		process.exit(1);
	}
	return { flags, target: targets[0] };
}

function workspaceNames() {
	const result = spawnSync(NPM, ["pkg", "get", "name", "--workspaces", "--json"], { encoding: "utf8" });
	if (result.status !== 0) {
		console.error(result.stderr?.trim() || "Failed to enumerate npm workspaces.");
		process.exit(result.status ?? 1);
	}
	return Object.keys(JSON.parse(result.stdout));
}

const { flags, target } = parseArguments(process.argv.slice(2));
const names = workspaceNames();
const lockstepNames = names.filter((name) => !INDEPENDENT_PACKAGES.has(name));
const skippedNames = names.filter((name) => INDEPENDENT_PACKAGES.has(name));

if (lockstepNames.length === 0) {
	console.error("No lockstep workspace packages found.");
	process.exit(1);
}

for (const name of skippedNames) {
	console.log(`Skipping ${name} (independent release line).`);
}

const result = spawnSync(NPM, ["version", target, ...flags, ...lockstepNames.map((name) => `--workspace=${name}`)], {
	stdio: "inherit",
});

process.exit(result.status ?? 1);
