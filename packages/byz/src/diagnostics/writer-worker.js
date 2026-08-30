import { randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { enforceDiagnosticsRetention } from "./retention.js";
import { captureUpdateBaseline, recordUpdateResult } from "./update-health.js";

const { home, generation, retentionDays, maxBytes } = workerData;
const workerId = `${process.pid}-${randomUUID()}`;
let shardPath;
let stopped = false;
let writes = 0;

function classifyError(error) {
	if (error?.code === "EACCES" || error?.code === "EPERM") return "permission";
	if (error?.code === "ENOSPC" || error?.code === "EDQUOT") return "disk_full";
	return "unknown";
}

async function currentGeneration() {
	try {
		const config = JSON.parse(await readFile(join(home, "config.json"), "utf8"));
		return config.generation;
	} catch {
		return generation;
	}
}

async function ensureShard() {
	if (shardPath) return shardPath;
	const day = new Date().toISOString().slice(0, 10);
	const directory = join(home, "events", String(generation), day);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	shardPath = join(directory, `${new Date().toISOString().replaceAll(":", "-")}-${workerId}.jsonl`);
	await writeFile(shardPath, "", { flag: "wx", mode: 0o600 });
	await chmod(shardPath, 0o600);
	return shardPath;
}

async function writeState(status, reason = "unknown") {
	try {
		const directory = join(home, "state", String(generation));
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const path = join(directory, `${workerId}.json`);
		await writeFile(
			path,
			`${JSON.stringify({ schemaVersion: 1, status, reason, writes, at: new Date().toISOString() })}\n`,
			{ mode: 0o600 },
		);
		await chmod(path, 0o600);
	} catch {
		// State is diagnostic metadata and cannot affect event acknowledgement.
	}
}

async function handleRecord(message) {
	if (stopped) return { reason: "worker_exit" };
	if ((await currentGeneration()) !== generation) {
		stopped = true;
		await writeState("stopped", "generation_changed");
		return { reason: "generation_changed" };
	}
	try {
		await appendFile(await ensureShard(), `${JSON.stringify(message.event)}\n`, { encoding: "utf8", mode: 0o600 });
		writes++;
		if (writes % 20 === 0) await writeState("ok");
		if (writes % 100 === 0) await enforceDiagnosticsRetention({ home, retentionDays, maxBytes });
		return {};
	} catch (error) {
		stopped = true;
		const reason = classifyError(error);
		await writeState("degraded", reason);
		return { reason };
	}
}

async function handleMessage(message) {
	if (!message || typeof message.id !== "number") return;
	let result = {};
	if (message.type === "record") result = await handleRecord(message);
	else if (message.type === "capture-update") {
		await captureUpdateBaseline({ home, ...message.data }).catch(() => {});
		await enforceDiagnosticsRetention({ home, retentionDays, maxBytes }).catch(() => {});
	} else if (message.type === "update-result") {
		await recordUpdateResult({ home, ...message.data }).catch(() => {});
		await enforceDiagnosticsRetention({ home, retentionDays, maxBytes }).catch(() => {});
	} else return;
	parentPort?.postMessage({ type: "ack", id: message.id, ...result });
}

try {
	await mkdir(home, { recursive: true, mode: 0o700 });
	await chmod(home, 0o700);
	await writeState("ready");
	let pending = Promise.resolve();
	parentPort?.on("message", (message) => {
		pending = pending
			.then(() => handleMessage(message))
			.catch(() => {
				if (typeof message?.id === "number") {
					parentPort?.postMessage({ type: "ack", id: message.id, reason: "unknown" });
				}
			});
	});
	parentPort?.postMessage({ type: "ready" });
} catch (error) {
	stopped = true;
	parentPort?.postMessage({ type: "degraded", reason: classifyError(error) });
}
