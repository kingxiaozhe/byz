import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const codingAgentDir = join(packageDir, "..", "coding-agent");
const codingAgentDist = join(codingAgentDir, "dist");
const distDir = join(packageDir, "dist");

await Promise.all([
	rm(distDir, { force: true, recursive: true }),
	rm(join(packageDir, "docs"), { force: true, recursive: true }),
	rm(join(packageDir, "examples"), { force: true, recursive: true }),
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
await cp(join(codingAgentDir, "docs"), join(packageDir, "docs"), {
	force: true,
	recursive: true,
});
await cp(join(codingAgentDir, "examples"), join(packageDir, "examples"), {
	force: true,
	recursive: true,
});
await chmod(join(distDir, "cli.js"), 0o755);

console.log("Built packages/byz/dist from the pinned Pi coding-agent artifacts.");
