import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { getDiagnosticsHome, readDiagnosticsConfig } from "./config.js";
import { scanDiagnosticEvents, summarizeDiagnosticEvents } from "./reader.js";
import { enforceDiagnosticsRetention } from "./retention.js";

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

async function assertSafeParent(parent) {
	const info = await lstat(parent);
	if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("output parent is unsafe");
	return { dev: info.dev, ino: info.ino };
}

async function sameParent(parent, identity) {
	const info = await lstat(parent);
	return info.isDirectory() && !info.isSymbolicLink() && info.dev === identity.dev && info.ino === identity.ino;
}

export async function createDiagnosticsExport(options = {}) {
	const home = options.home ?? getDiagnosticsHome();
	const scan = await scanDiagnosticEvents({ home, since: options.since ?? 0 });
	if (scan.unavailable > 0) throw new Error("diagnostic data failed privacy validation");
	const summary = summarizeDiagnosticEvents(scan.events, 0);
	const defaultParent = join(home, "exports");
	const requested = options.output ? resolve(options.output) : undefined;
	const parent = requested ? dirname(requested) : defaultParent;
	await mkdir(parent, { recursive: true, mode: 0o700 });
	const parentIdentity = await assertSafeParent(parent);
	const finalPath = requested ?? join(parent, `byz-diagnostics-${new Date().toISOString().replaceAll(":", "-")}`);
	try {
		await lstat(finalPath);
		throw new Error("output already exists");
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	const temporary = await mkdtemp(join(parent, ".byz-diagnostics-"));
	try {
		await chmod(temporary, 0o700);
		const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
		const manifest = {
			schemaVersion: 1,
			generatedAt: new Date().toISOString(),
			range: { since: options.since ?? 0 },
			eventCount: scan.events.length,
			summarySha256: sha256(summaryText),
			byzVersion: options.byzVersion ?? "unknown",
			runtimeCategory: options.runtimeCategory ?? "node",
		};
		const files = [
			["manifest.json", `${JSON.stringify(manifest, null, 2)}\n`],
			["summary.json", summaryText],
			[
				"privacy-report.txt",
				"BYZ diagnostics privacy report\nIncluded: aggregate counts, versions, time range.\nExcluded: prompts, responses, code, paths, tool arguments/output, credentials, headers, URLs, raw events.\n",
			],
		];
		for (const [name, content] of files) {
			const path = join(temporary, name);
			await writeFile(path, content, { mode: 0o600, flag: "wx" });
			await chmod(path, 0o600);
		}
		if (!(await sameParent(parent, parentIdentity))) throw new Error("output parent changed during export");
		await rename(temporary, finalPath);
		const config = readDiagnosticsConfig(home);
		await enforceDiagnosticsRetention({
			home,
			retentionDays: config.retentionDays,
			maxBytes: config.maxBytes,
		});
		await lstat(finalPath);
		return finalPath;
	} catch (error) {
		await rm(temporary, { recursive: true, force: true }).catch(() => {});
		throw error;
	}
}

export async function inspectDiagnosticsExport(path) {
	const resolved = resolve(path);
	const info = await stat(resolved);
	if (!info.isDirectory()) throw new Error("diagnostics export is not a directory");
	const manifest = JSON.parse(await readFile(join(resolved, "manifest.json"), "utf8"));
	return { name: basename(resolved), manifest };
}
