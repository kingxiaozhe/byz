import { chmod, cp, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const codingAgentDir = join(packageDir, "..", "coding-agent");
const codingAgentDist = join(codingAgentDir, "dist");
const distDir = join(packageDir, "dist");
const runtimeAssetPaths = [
	"modes/interactive/theme/dark.json",
	"modes/interactive/theme/light.json",
	"modes/interactive/theme/theme-schema.json",
	"modes/interactive/assets/clankolas.png",
	"core/export-html/template.html",
	"core/export-html/template.css",
	"core/export-html/template.js",
	"core/export-html/vendor/marked.min.js",
	"core/export-html/vendor/highlight.min.js",
];
const workflowsDir = join(packageDir, "workflows");
const byzPackageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
const workflowLock = JSON.parse(await readFile(join(packageDir, "workflows.lock.json"), "utf8"));
const bundledPackages = [];
for (const workflow of Object.values(workflowLock.workflows)) {
	if (!workflow.bundled || !workflow.bundledPath) continue;
	const workflowPackageJsonPath = require.resolve(`${workflow.packageName}/package.json`);
	const workflowPackageDir = dirname(workflowPackageJsonPath);
	const workflowPackageJson = JSON.parse(await readFile(workflowPackageJsonPath, "utf8"));
	if (byzPackageJson.devDependencies?.[workflow.packageName] !== workflow.source) {
		throw new Error(`Workflow package source mismatch for ${workflow.packageName}.`);
	}
	if (
		workflowPackageJson.name !== workflow.packageName ||
		workflowPackageJson.version !== workflow.version ||
		workflowPackageJson.license !== workflow.license
	) {
		throw new Error(
			`Workflow package lock mismatch: expected ${workflow.packageName}@${workflow.version} (${workflow.license}), ` +
				`found ${workflowPackageJson.name}@${workflowPackageJson.version} (${workflowPackageJson.license}).`,
		);
	}
	bundledPackages.push({ packageDir: workflowPackageDir, workflow });
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
await Promise.all(
	runtimeAssetPaths.map(async (relativePath) => {
		const targetPath = join(distDir, relativePath);
		await mkdir(dirname(targetPath), { recursive: true });
		await cp(join(codingAgentDist, relativePath), targetPath, { force: true });
	}),
);
await cp(join(packageDir, "src", "cli.js"), join(distDir, "cli.js"), {
	force: true,
});
await cp(join(packageDir, "src", "fast.js"), join(distDir, "fast.js"), {
	force: true,
});
await cp(join(packageDir, "src", "fast-session.js"), join(distDir, "fast-session.js"), {
	force: true,
});
await cp(join(packageDir, "src", "prewalk.js"), join(distDir, "prewalk.js"), {
	force: true,
});
await cp(join(packageDir, "src", "workflow-switch.js"), join(distDir, "workflow-switch.js"), {
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
await Promise.all(
	bundledPackages.map(({ packageDir: workflowPackageDir, workflow }) =>
		cp(workflowPackageDir, join(packageDir, workflow.bundledPath), {
			force: true,
			recursive: true,
		}),
	),
);
await chmod(join(distDir, "cli.js"), 0o755);

console.log("Built BYZ from pinned Pi artifacts and locked workflow packages.");
