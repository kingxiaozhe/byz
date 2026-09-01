import assert from "node:assert/strict";
import { appendFile, lstat, mkdir, mkdtemp, open, opendir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";
import test from "node:test";
import { readCmRecoveryEvidence } from "../src/recovery/cm-evidence-reader.js";

const nativeFs = { lstat, open, opendir, realpath };

async function createFixture(root, name, options = {}) {
	const candidate = join(root, "specs", name);
	const feature = join(candidate, "1.recovery");
	await mkdir(join(candidate, ".reviews"), { recursive: true });
	await mkdir(feature, { recursive: true });
	await writeFile(
		join(candidate, ".cm-specs-status"),
		JSON.stringify({ status: options.specStatus ?? "approved", features: ["1.recovery"] }),
	);
	await writeFile(
		join(candidate, ".cm-status.json"),
		JSON.stringify({ node: "N3", feature: "1.recovery", task: "T-011", state: options.cmState ?? "running" }),
	);
	await writeFile(
		join(candidate, ".cm-run.json"),
		JSON.stringify({
			schema_version: 1,
			run_id: `run-${name}`,
			workflow: "cm-ai",
			status: options.runStatus ?? "running",
		}),
	);
	await writeFile(join(feature, "tasks.md"), `- [${options.completed ? "x" : " "}] T-011: recovery\n`);
	if (options.reviewVerdict) {
		await writeFile(
			join(candidate, ".reviews", `${name}-T-011-r1.md`),
			`---\ntask: T-011\nattempt: 1\nround: 1\nverdict: ${options.reviewVerdict}\nhandoff: fixture.json\nhandoff_sha256: ${"a".repeat(64)}\n---\n`,
		);
	}
	return candidate;
}

async function withProject(run) {
	const root = await mkdtemp(join(tmpdir(), "byz-recovery-reader-"));
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function changedIdentity(stats) {
	return new Proxy(stats, {
		get(target, property) {
			if (property === "ino") return target.ino + 1n;
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

test("untrusted projects perform zero filesystem operations", async () => {
	let accesses = 0;
	const fs = new Proxy(
		{},
		{
			get() {
				accesses += 1;
				throw new Error("filesystem must remain untouched");
			},
		},
	);
	assert.deepEqual(await readCmRecoveryEvidence({ projectRoot: "/untrusted", isTrusted: false, fs }), {
		state: "not-eligible",
	});
	assert.equal(accesses, 0);
});

test("trusted reader returns one bounded project-local snapshot without opening JSONL", async () => {
	await withProject(async (root) => {
		const candidate = await createFixture(root, "current", { reviewVerdict: "approved" });
		await mkdir(join(root, "specs", "non-cm-notes"));
		await writeFile(join(candidate, "运行日志.jsonl"), "SECRET-MARKER\n");
		await appendFile(join(candidate, ".reviews", "current-T-011-r1.md"), `PRIVATE-BODY-${"x".repeat(100_000)}`);
		const opened = [];
		let reviewBytesRead = 0;
		const fs = {
			...nativeFs,
			async open(path, flags) {
				opened.push(path);
				const handle = await open(path, flags);
				return {
					stat: (options) => handle.stat(options),
					async read(...args) {
						const result = await handle.read(...args);
						if (path.endsWith("current-T-011-r1.md")) reviewBytesRead += result.bytesRead;
						return result;
					},
					close: () => handle.close(),
				};
			},
		};
		const result = await readCmRecoveryEvidence({ projectRoot: root, isTrusted: true, fs });
		assert.equal(result.state, "found");
		assert.equal(result.value.candidateCount, 1);
		assert.equal(result.value.run.runId, "run-current");
		assert.equal(result.value.reviews[0].historical, true);
		assert.ok(result.receipt.sources.length >= 5);
		assert.ok(result.receipt.sources.every((source) => !source.relativePath.startsWith("/") && source.size >= 0));
		const reviewReceipt = result.receipt.sources.find((source) => source.relativePath.endsWith("-T-011-r1.md"));
		assert.ok(reviewReceipt.size < 1_000);
		assert.equal(reviewBytesRead, 32_768);
		assert.equal(
			opened.some((path) => path.endsWith("运行日志.jsonl")),
			false,
		);
	});
});

test("multiple active project-local candidates are returned only as a decision count", async () => {
	await withProject(async (root) => {
		await createFixture(root, "first");
		await createFixture(root, "second");
		const result = await readCmRecoveryEvidence({ projectRoot: root, isTrusted: true });
		assert.equal(result.state, "found");
		assert.deepEqual(result.value, { candidateCount: 2 });
		assert.equal(result.receipt.runId, "multiple");
	});
});

test("running and each unresolved done lifecycle remain actionable while done-resolved is absent", async () => {
	const cases = [
		["running", {}, "found"],
		[
			"done-awaiting-review",
			{ runStatus: "done", specStatus: "awaiting_review", cmState: "run_done", completed: true },
			"found",
		],
		["done-paused", { runStatus: "done", cmState: "paused_for_human", completed: true }, "found"],
		["done-blocked", { runStatus: "done", cmState: "blocked", completed: true }, "found"],
		["done-resolved", { runStatus: "done", cmState: "run_done", completed: true }, "absent"],
	];
	for (const [name, options, expectedState] of cases) {
		await withProject(async (root) => {
			await createFixture(root, name, options);
			const result = await readCmRecoveryEvidence({ projectRoot: root, isTrusted: true });
			assert.equal(result.state, expectedState, name);
		});
	}
});

test("candidate enumeration and pre-existing symlinks fail closed", async () => {
	await withProject(async (root) => {
		await mkdir(join(root, "specs"), { recursive: true });
		for (const name of ["one", "two", "three"]) await mkdir(join(root, "specs", name));
		assert.deepEqual(
			await readCmRecoveryEvidence({
				projectRoot: root,
				isTrusted: true,
				limits: {
					candidateCount: 2,
					reviewCount: 4,
					stateFileBytes: 1_048_576,
					reviewFileBytes: 524_288,
					snapshotBytes: 4_194_304,
				},
			}),
			{ state: "rejected", reasonCode: "candidate_limit" },
		);
	});
	await withProject(async (root) => {
		const outside = await mkdtemp(join(tmpdir(), "byz-recovery-outside-"));
		try {
			await mkdir(join(root, "specs"), { recursive: true });
			await symlink(outside, join(root, "specs", "escape"), "dir");
			assert.deepEqual(await readCmRecoveryEvidence({ projectRoot: root, isTrusted: true }), {
				state: "rejected",
				reasonCode: "unsafe_path",
			});
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});
});

test(
	"directory junctions are rejected before candidate reads",
	{
		skip:
			platform !== "win32"
				? "distinct directory junctions/reparse points cannot be constructed on this platform"
				: false,
	},
	async () => {
		await withProject(async (root) => {
			const outside = await mkdtemp(join(tmpdir(), "byz-recovery-junction-outside-"));
			try {
				await mkdir(join(root, "specs"), { recursive: true });
				await symlink(outside, join(root, "specs", "junction"), "junction");
				assert.deepEqual(await readCmRecoveryEvidence({ projectRoot: root, isTrusted: true }), {
					state: "rejected",
					reasonCode: "unsafe_path",
				});
			} finally {
				await rm(outside, { recursive: true, force: true });
			}
		});
	},
);

test("review count, snapshot total and leaf symlink limits fail closed", async () => {
	await withProject(async (root) => {
		const candidate = await createFixture(root, "current");
		for (let round = 1; round <= 5; round++) {
			await writeFile(
				join(candidate, ".reviews", `current-T-011-r${round}.md`),
				`---\ntask: T-011\nattempt: 1\nround: 1\nverdict: approved\nhandoff: fixture.json\nhandoff_sha256: ${"a".repeat(64)}\n---\n`,
			);
		}
		const result = await readCmRecoveryEvidence({ projectRoot: root, isTrusted: true });
		assert.deepEqual(result, { state: "rejected", reasonCode: "review_limit" });
	});
	await withProject(async (root) => {
		await createFixture(root, "current");
		const result = await readCmRecoveryEvidence({
			projectRoot: root,
			isTrusted: true,
			limits: {
				candidateCount: 64,
				reviewCount: 4,
				stateFileBytes: 1_024,
				reviewFileBytes: 512,
				snapshotBytes: 180,
			},
		});
		assert.deepEqual(result, { state: "rejected", reasonCode: "size_limit" });
	});
	await withProject(async (root) => {
		const candidate = await createFixture(root, "current");
		const outside = join(root, "outside-run.json");
		await writeFile(outside, JSON.stringify({ schema_version: 1, run_id: "outside", status: "running" }));
		await rm(join(candidate, ".cm-run.json"));
		await symlink(outside, join(candidate, ".cm-run.json"));
		assert.deepEqual(await readCmRecoveryEvidence({ projectRoot: root, isTrusted: true }), {
			state: "rejected",
			reasonCode: "unsafe_path",
		});
	});
});

test("non-regular leaf files are rejected before open", async () => {
	await withProject(async (root) => {
		const candidate = await createFixture(root, "current");
		await rm(join(candidate, ".cm-run.json"));
		await mkdir(join(candidate, ".cm-run.json"));
		let opens = 0;
		const fs = {
			...nativeFs,
			async open(...args) {
				opens += 1;
				return open(...args);
			},
		};
		assert.deepEqual(await readCmRecoveryEvidence({ projectRoot: root, isTrusted: true, fs }), {
			state: "rejected",
			reasonCode: "unsafe_path",
		});
		assert.equal(opens, 0);
	});
});

test("project and specs identity replacements independently discard the complete snapshot", async () => {
	for (const boundaryName of ["project", "specs"]) {
		await withProject(async (root) => {
			await createFixture(root, "current");
			const canonicalRoot = await realpath(root);
			const target = boundaryName === "project" ? canonicalRoot : await realpath(join(root, "specs"));
			let targetStats = 0;
			const fs = {
				...nativeFs,
				async lstat(path, options) {
					const stats = await lstat(path, options);
					if (path !== target || ++targetStats === 1) return stats;
					return changedIdentity(stats);
				},
			};
			assert.deepEqual(
				await readCmRecoveryEvidence({ projectRoot: canonicalRoot, isTrusted: true, fs }),
				{
					state: "rejected",
					reasonCode: "source_changed",
				},
				boundaryName,
			);
		});
	}
});

test("leaf identity replacement discards the complete snapshot", async () => {
	await withProject(async (root) => {
		const candidate = await createFixture(root, "current");
		const runPath = await realpath(join(candidate, ".cm-run.json"));
		const fs = {
			...nativeFs,
			async open(path, flags) {
				const handle = await open(path, flags);
				if (path !== runPath) return handle;
				let stats = 0;
				return {
					async stat(options) {
						const value = await handle.stat(options);
						return ++stats === 1 ? value : changedIdentity(value);
					},
					read: (...args) => handle.read(...args),
					close: () => handle.close(),
				};
			},
		};
		assert.deepEqual(await readCmRecoveryEvidence({ projectRoot: root, isTrusted: true, fs }), {
			state: "rejected",
			reasonCode: "source_changed",
		});
	});
});

test("oversized state files are rejected before any file bytes are read", async () => {
	await withProject(async (root) => {
		const candidate = await createFixture(root, "current");
		await writeFile(
			join(candidate, ".cm-run.json"),
			JSON.stringify({
				schema_version: 1,
				run_id: "run-current",
				workflow: "cm-ai",
				status: "running",
				global_log: "x".repeat(2_000),
			}),
		);
		let reads = 0;
		const fs = {
			...nativeFs,
			async open(path, flags) {
				const handle = await open(path, flags);
				return {
					stat: (options) => handle.stat(options),
					read: (...args) => {
						reads += 1;
						return handle.read(...args);
					},
					close: () => handle.close(),
				};
			},
		};
		const result = await readCmRecoveryEvidence({
			projectRoot: root,
			isTrusted: true,
			fs,
			limits: {
				candidateCount: 64,
				reviewCount: 4,
				stateFileBytes: 512,
				reviewFileBytes: 512,
				snapshotBytes: 4_096,
			},
		});
		assert.deepEqual(result, { state: "rejected", reasonCode: "size_limit" });
		assert.equal(reads, 0, "the oversized run marker is rejected before any source bytes are read");
	});
});
