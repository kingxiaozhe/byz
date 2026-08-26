import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
await Promise.all([
	rm(join(packageDir, "dist"), { force: true, recursive: true }),
	rm(join(packageDir, "docs"), { force: true, recursive: true }),
	rm(join(packageDir, "examples"), { force: true, recursive: true }),
	rm(join(packageDir, "workflows"), { force: true, recursive: true }),
]);
