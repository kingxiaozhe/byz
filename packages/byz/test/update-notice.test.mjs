import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	formatUpdateNotice,
	isCacheFresh,
	readCachedRelease,
	resolveUpdateHome,
	shouldRefresh,
	updateCheckEnabled,
	writeCachedRelease,
} from "../src/update-notice.js";

const DAY = 24 * 60 * 60 * 1000;

test("reports only a genuinely newer release", () => {
	const cached = { checkedAt: 1, version: "0.2.0" };
	assert.match(formatUpdateNotice("0.1.16", cached), /BYZ 0\.2\.0 is available \(you have 0\.1\.16\)/);
	assert.match(formatUpdateNotice("0.1.16", cached), /byz update/);
	// Same or older than what is installed says nothing, and neither does a missing cache.
	assert.equal(formatUpdateNotice("0.2.0", cached), undefined);
	assert.equal(formatUpdateNotice("0.3.0", cached), undefined);
	assert.equal(formatUpdateNotice("0.1.16", undefined), undefined);
	assert.equal(formatUpdateNotice("not-a-version", cached), undefined);
});

test("treats a damaged or future-dated cache as nothing to report", async () => {
	const home = await mkdtemp(join(tmpdir(), "byz-update-"));
	try {
		assert.equal(readCachedRelease(home), undefined);
		await writeFile(join(home, "latest.json"), "{ not json");
		assert.equal(readCachedRelease(home), undefined);
		await writeFile(join(home, "latest.json"), JSON.stringify({ version: "nope", checkedAt: 1 }));
		assert.equal(readCachedRelease(home), undefined);

		const now = Date.now();
		assert.equal(isCacheFresh({ checkedAt: now, version: "1.0.0" }, now), true);
		assert.equal(isCacheFresh({ checkedAt: now - 2 * DAY, version: "1.0.0" }, now), false);
		// A cache stamped in the future means the clock moved, not that the answer is fresh.
		assert.equal(isCacheFresh({ checkedAt: now + DAY, version: "1.0.0" }, now), false);
	} finally {
		await rm(home, { force: true, recursive: true });
	}
});

test("persists a valid release and refuses an invalid one", async () => {
	const home = await mkdtemp(join(tmpdir(), "byz-update-"));
	try {
		assert.equal(writeCachedRelease({ checkedAt: 1730000000000, version: "0.2.0" }, home), true);
		assert.deepEqual(readCachedRelease(home), { checkedAt: 1730000000000, version: "0.2.0" });
		assert.equal(JSON.parse(await readFile(join(home, "latest.json"), "utf8")).version, "0.2.0");

		assert.equal(writeCachedRelease({ checkedAt: 1730000000000, version: "0.2" }, home), false);
		assert.equal(writeCachedRelease({ version: "0.2.0" }, home), false);
		// The rejected writes leave the stored answer alone.
		assert.deepEqual(readCachedRelease(home), { checkedAt: 1730000000000, version: "0.2.0" });
	} finally {
		await rm(home, { force: true, recursive: true });
	}
});

test("refreshes only when the answer is stale and the check is enabled", () => {
	const now = Date.now();
	const fresh = { checkedAt: now, version: "0.2.0" };
	const stale = { checkedAt: now - 2 * DAY, version: "0.2.0" };

	assert.equal(shouldRefresh(undefined, now, { env: {} }), true);
	assert.equal(shouldRefresh(stale, now, { env: {} }), true);
	assert.equal(shouldRefresh(fresh, now, { env: {} }), false);
	// Opting out stops the refresh even with nothing cached.
	assert.equal(shouldRefresh(undefined, now, { env: { BYZ_UPDATE_CHECK: "0" } }), false);
});

test("honours the opt-out and the home override", () => {
	assert.equal(updateCheckEnabled({}), true);
	assert.equal(updateCheckEnabled({ BYZ_UPDATE_CHECK: "1" }), true);
	assert.equal(updateCheckEnabled({ BYZ_UPDATE_CHECK: "0" }), false);
	assert.equal(resolveUpdateHome({ BYZ_UPDATE_HOME: "/tmp/byz-update-home" }), "/tmp/byz-update-home");
	assert.match(resolveUpdateHome({}), /[\\/]\.byz[\\/]update$/);
});
