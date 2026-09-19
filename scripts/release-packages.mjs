import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INDEPENDENT_PACKAGES, findPackageDirectories } from "./package-workspaces.mjs";

export function getPublicWorkspacePackages() {
	return findPackageDirectories()
		.map((directory) => ({
			directory,
			...JSON.parse(readFileSync(join(directory, "package.json"), "utf8")),
		}))
		.filter((pkg) => pkg.private !== true)
		// Independently released packages ship on their own tag and are not part of a Pi release.
		.filter((pkg) => !INDEPENDENT_PACKAGES.has(pkg.name))
		.map(({ directory, name, version }) => ({ directory, name, version }));
}
