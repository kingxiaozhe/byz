import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

async function measure(path) {
	const info = await lstat(path);
	if (info.isSymbolicLink()) return undefined;
	if (info.isFile()) return { path, size: info.size, mtimeMs: info.mtimeMs };
	if (!info.isDirectory()) return undefined;
	let size = 0;
	let mtimeMs = info.mtimeMs;
	for (const entry of await readdir(path, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) continue;
		const child = await measure(join(path, entry.name)).catch(() => undefined);
		if (!child) continue;
		size += child.size;
		mtimeMs = Math.max(mtimeMs, child.mtimeMs);
	}
	return { path, size, mtimeMs };
}

async function collectFiles(root, result) {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.isSymbolicLink()) continue;
		const path = join(root, entry.name);
		if (entry.isDirectory()) await collectFiles(path, result);
		else if (entry.isFile()) {
			const item = await measure(path).catch(() => undefined);
			if (item) result.push(item);
		}
	}
}

async function collectTopLevel(root, result) {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.isSymbolicLink()) continue;
		const item = await measure(join(root, entry.name)).catch(() => undefined);
		if (item) result.push(item);
	}
}

export async function enforceDiagnosticsRetention(options) {
	const { home, retentionDays, maxBytes } = options;
	const units = [];
	for (const name of ["events", "state", "summaries"]) await collectFiles(join(home, name), units);
	for (const name of ["updates", "exports"]) await collectTopLevel(join(home, name), units);
	const cutoff = Date.now() - retentionDays * 86_400_000;
	for (const item of units.filter((value) => value.mtimeMs < cutoff)) {
		await rm(item.path, { recursive: true, force: true });
	}
	const remaining = [];
	for (const item of units.filter((value) => value.mtimeMs >= cutoff)) {
		const refreshed = await measure(item.path).catch(() => undefined);
		if (refreshed) remaining.push(refreshed);
	}
	remaining.sort((a, b) => a.mtimeMs - b.mtimeMs);
	let total = remaining.reduce((sum, item) => sum + item.size, 0);
	for (const item of remaining) {
		if (total <= maxBytes) break;
		await rm(item.path, { recursive: true, force: true });
		total -= item.size;
	}
	return { bytes: Math.max(0, total), units: remaining.length };
}
