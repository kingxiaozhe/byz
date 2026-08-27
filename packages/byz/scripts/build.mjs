import { chmod, cp, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const codingAgentDir = join(packageDir, "..", "coding-agent");
const codingAgentDist = join(codingAgentDir, "dist");
const distDir = join(packageDir, "dist");
const workflowsDir = join(packageDir, "workflows");
const byzPackageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
const workflowLock = JSON.parse(await readFile(join(packageDir, "workflows.lock.json"), "utf8"));
const cmWorkflow = workflowLock.workflows.cm;
const cmPackageJsonPath = require.resolve(`${cmWorkflow.packageName}/package.json`);
const cmPackageDir = dirname(cmPackageJsonPath);
const cmPackageJson = JSON.parse(await readFile(cmPackageJsonPath, "utf8"));

if (byzPackageJson.devDependencies?.[cmWorkflow.packageName] !== cmWorkflow.source) {
	throw new Error(`CM package source mismatch for ${cmWorkflow.packageName}.`);
}
if (cmPackageJson.name !== cmWorkflow.packageName || cmPackageJson.version !== cmWorkflow.version) {
	throw new Error(
		`CM package lock mismatch: expected ${cmWorkflow.packageName}@${cmWorkflow.version}, ` +
			`found ${cmPackageJson.name}@${cmPackageJson.version}.`,
	);
}

await Promise.all([
	rm(distDir, { force: true, recursive: true }),
	rm(join(packageDir, "docs"), { force: true, recursive: true }),
	rm(join(packageDir, "examples"), { force: true, recursive: true }),
	rm(workflowsDir, { force: true, recursive: true }),
]);
await mkdir(distDir, { recursive: true });
await cp(codingAgentDist, join(distDir, "runtime"), {
	force: true,
	recursive: true,
});
await cp(join(packageDir, "src", "cli.js"), join(distDir, "cli.js"), {
	force: true,
});
await cp(join(packageDir, "src", "workflows.js"), join(distDir, "workflows.js"), {
	force: true,
});
await cp(join(packageDir, "src", "update.js"), join(distDir, "update.js"), {
	force: true,
});
await cp(join(codingAgentDir, "docs"), join(packageDir, "docs"), {
	force: true,
	recursive: true,
});
await cp(join(codingAgentDir, "examples"), join(packageDir, "examples"), {
	force: true,
	recursive: true,
});
await cp(cmPackageDir, join(packageDir, cmWorkflow.bundledPath), {
	force: true,
	recursive: true,
});
await chmod(join(distDir, "cli.js"), 0o755);

console.log("Built BYZ from pinned Pi artifacts and the locked CM workflow package.");
