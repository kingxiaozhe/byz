import assert from "node:assert/strict";
import test from "node:test";
import { createUpdateNoticeExtension } from "../src/update-notice-extension.js";

const DAY = 24 * 60 * 60 * 1000;

function createPorts() {
	const handlers = new Map();
	const notices = [];
	const ports = { on: (event, handler) => handlers.set(event, handler) };
	const ctx = {
		ui: {
			notify: (message, level) => {
				notices.push({ level, message });
			},
		},
	};
	return { ctx, handlers, notices, ports };
}

async function start(extension, ports, ctx) {
	extension(ports.ports);
	await ports.handlers.get("session_start")({ type: "session_start" }, ctx);
	// The refresh is intentionally detached; let it settle before asserting on it.
	await new Promise((resolve) => setImmediate(resolve));
}

test("announces a newer cached release once, without fetching at startup", async () => {
	const ports = createPorts();
	let fetched = 0;
	const extension = createUpdateNoticeExtension({
		currentVersion: "0.1.16",
		env: {},
		fetchLatest: async () => {
			fetched += 1;
			return { version: "0.2.0" };
		},
		now: () => 1_000,
		readCache: () => ({ checkedAt: 1_000, version: "0.2.0" }),
		writeCache: () => true,
	});

	await start(extension, ports, ports.ctx);

	assert.equal(ports.notices.length, 1);
	assert.match(ports.notices[0].message, /BYZ 0\.2\.0 is available/);
	assert.equal(ports.notices[0].level, "info");
	// The cache was fresh, so startup neither waited on nor triggered a network call.
	assert.equal(fetched, 0);
});

test("says nothing when the installed version is current", async () => {
	const ports = createPorts();
	const extension = createUpdateNoticeExtension({
		currentVersion: "0.2.0",
		env: {},
		now: () => 1_000,
		readCache: () => ({ checkedAt: 1_000, version: "0.2.0" }),
		writeCache: () => true,
	});

	await start(extension, ports, ports.ctx);
	assert.deepEqual(ports.notices, []);
});

test("refreshes a stale answer in the background for the next session", async () => {
	const ports = createPorts();
	const written = [];
	const extension = createUpdateNoticeExtension({
		currentVersion: "0.1.16",
		env: {},
		fetchLatest: async () => ({ version: "0.3.0" }),
		now: () => 10 * DAY,
		readCache: () => ({ checkedAt: 1_000, version: "0.2.0" }),
		writeCache: (entry) => written.push(entry),
	});

	await start(extension, ports, ports.ctx);

	// The line shown is the cached one; the fresher answer only lands on disk.
	assert.match(ports.notices[0].message, /BYZ 0\.2\.0 is available/);
	assert.deepEqual(written, [{ checkedAt: 10 * DAY, version: "0.3.0" }]);
});

test("a failing refresh and a broken cache both stay silent", async () => {
	const failing = createPorts();
	await start(
		createUpdateNoticeExtension({
			currentVersion: "0.1.16",
			env: {},
			fetchLatest: async () => {
				throw new Error("offline");
			},
			now: () => 10 * DAY,
			readCache: () => undefined,
			writeCache: () => true,
		}),
		failing,
		failing.ctx,
	);
	assert.deepEqual(failing.notices, []);

	const broken = createPorts();
	await start(
		createUpdateNoticeExtension({
			currentVersion: "0.1.16",
			env: {},
			now: () => 1_000,
			readCache: () => {
				throw new Error("damaged cache");
			},
			writeCache: () => true,
		}),
		broken,
		broken.ctx,
	);
	assert.deepEqual(broken.notices, []);
});

test("BYZ_UPDATE_CHECK=0 disables the notice and the refresh", async () => {
	const ports = createPorts();
	let fetched = 0;
	const extension = createUpdateNoticeExtension({
		currentVersion: "0.1.16",
		env: { BYZ_UPDATE_CHECK: "0" },
		fetchLatest: async () => {
			fetched += 1;
			return { version: "0.3.0" };
		},
		now: () => 10 * DAY,
		readCache: () => ({ checkedAt: 1_000, version: "0.2.0" }),
		writeCache: () => true,
	});

	await start(extension, ports, ports.ctx);

	assert.deepEqual(ports.notices, []);
	assert.equal(fetched, 0);
});

test("aborts an in-flight refresh at shutdown so it cannot hold the process open", async () => {
	const ports = createPorts();
	let aborted = false;
	const extension = createUpdateNoticeExtension({
		currentVersion: "0.1.16",
		env: {},
		fetchLatest: (_version, signal) =>
			new Promise((_resolve, reject) => {
				signal?.addEventListener("abort", () => {
					aborted = true;
					reject(new Error("aborted"));
				});
			}),
		now: () => 10 * DAY,
		readCache: () => undefined,
		writeCache: () => true,
	});

	await start(extension, ports, ports.ctx);
	assert.equal(aborted, false);
	await ports.handlers.get("session_shutdown")({ type: "session_shutdown" }, ports.ctx);
	// Node keeps the event loop alive for an open socket, so an unattended request delayed exit by
	// the full request timeout.
	assert.equal(aborted, true);
});

test("records a failed attempt so an offline machine stops asking every launch", async () => {
	const ports = createPorts();
	const written = [];
	const extension = createUpdateNoticeExtension({
		currentVersion: "0.1.16",
		env: {},
		fetchLatest: async () => {
			throw new Error("offline");
		},
		now: () => 10 * DAY,
		readCache: () => ({ checkedAt: 1_000, version: "0.2.0" }),
		writeCache: (entry) => written.push(entry),
	});

	await start(extension, ports, ports.ctx);
	// The attempt is stamped, but the version already on record is left alone.
	assert.deepEqual(written, [{ checkedAt: 10 * DAY, version: "0.2.0" }]);
});
