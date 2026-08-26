import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import test from "node:test";
import { canonicalRepositoryId, runUpgrade, shellQuote } from "./byz-upgrade-pi.mjs";

function command(cwd, executable, args) {
	const result = spawnSync(executable, args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`${executable} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
	}
	return result.stdout.trim();
}

function git(cwd, ...args) {
	return command(cwd, "git", args);
}

function hasMergeHead(repo) {
	const gitPath = git(repo, "rev-parse", "--git-path", "MERGE_HEAD");
	return existsSync(isAbsolute(gitPath) ? gitPath : resolve(repo, gitPath));
}

function write(path, content) {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content);
}

function commitAll(repo, message) {
	git(repo, "add", "--all");
	git(repo, "commit", "-m", message);
	return git(repo, "rev-parse", "HEAD");
}

function configureGit(repo) {
	git(repo, "config", "user.name", "BYZ Test");
	git(repo, "config", "user.email", "byz-test@example.invalid");
}

function createFixture(
	t,
	{ checkoutBase = undefined, conflict = false, hostileTag = undefined, recordedBaseline = "v1.0.0" } = {},
) {
	const root = mkdtempSync(join(tmpdir(), "byz-upgrade-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const upstreamWork = join(root, "upstream-work");
	mkdirSync(upstreamWork);
	git(upstreamWork, "init", "-b", "main");
	configureGit(upstreamWork);
	write(join(upstreamWork, "packages/coding-agent/package.json"), '{"name":"coding-agent","version":"1.0.0"}\n');
	write(join(upstreamWork, "package-lock.json"), '{"lockfileVersion":3,"version":"1.0.0"}\n');
	write(join(upstreamWork, "shared.txt"), "base\n");
	const v100 = commitAll(upstreamWork, "upstream v1.0.0");
	git(upstreamWork, "tag", "v1.0.0");

	write(join(upstreamWork, "packages/coding-agent/package.json"), '{"name":"coding-agent","version":"1.1.0"}\n');
	write(join(upstreamWork, "package-lock.json"), '{"lockfileVersion":3,"version":"1.1.0"}\n');
	write(join(upstreamWork, "shared.txt"), "upstream\n");
	const v110 = commitAll(upstreamWork, "upstream v1.1.0");
	git(upstreamWork, "tag", "v1.1.0");
	if (hostileTag) git(upstreamWork, "tag", hostileTag);

	write(join(upstreamWork, "packages/coding-agent/package.json"), '{"name":"coding-agent","version":"1.2.0"}\n');
	write(join(upstreamWork, "future.txt"), "future\n");
	const untagged = commitAll(upstreamWork, "unreleased upstream");

	const upstreamBare = join(root, "upstream.git");
	command(root, "git", ["clone", "--bare", upstreamWork, upstreamBare]);
	const upstreamUrl = `file://${upstreamBare}`;

	const seed = join(root, "seed");
	mkdirSync(seed);
	git(seed, "init", "-b", "main");
	configureGit(seed);
	git(seed, "remote", "add", "upstream", upstreamUrl);
	git(seed, "fetch", "upstream", "main", "--no-tags");
	const baselineByName = { "untagged": untagged, "v1.0.0": v100, "v1.1.0": v110 };
	const baseline = baselineByName[recordedBaseline];
	git(seed, "reset", "--hard", baselineByName[checkoutBase ?? recordedBaseline]);

	if (conflict) write(join(seed, "shared.txt"), "byz\n");
	write(join(seed, "package.json"), '{"name":"byz-fixture","private":true,"type":"module"}\n');
	write(
		join(seed, "packages/byz/upstream.json"),
		`${JSON.stringify(
			{
				repository: upstreamUrl,
				commit: baseline,
				codingAgentVersion: recordedBaseline === "untagged" ? "1.2.0" : recordedBaseline.slice(1),
				checkedAt: "2026-08-25",
			},
			null,
			"\t",
		)}\n`,
	);
	write(join(seed, "packages/byz/package.json"), '{"name":"byz"}\n');
	write(join(seed, "packages/byz/src/cli.js"), 'if (command === "update") throw new Error("guarded");\n');
	write(join(seed, "packages/byz/src/workflows.js"), 'export const workflows = ["cm", "cm-plugin"];\n');
	write(join(seed, "packages/byz/scripts/build.mjs"), 'console.log("build BYZ");\n');
	write(join(seed, "packages/byz/scripts/clean.mjs"), 'console.log("clean BYZ");\n');
	write(join(seed, "packages/byz/test/smoke.test.mjs"), 'console.log("test BYZ");\n');
	write(join(seed, "packages/byz/workflows.lock.json"), '{"cm":"locked","cm-plugin":"separate"}\n');
	write(join(seed, "packages/byz/README.md"), "# BYZ fixture\n");
	commitAll(seed, "add BYZ downstream");

	const originBare = join(root, "origin.git");
	command(root, "git", ["clone", "--bare", seed, originBare]);
	const work = join(root, "work");
	command(root, "git", ["clone", originBare, work]);
	configureGit(work);
	git(work, "remote", "add", "upstream", upstreamUrl);

	return { baseline, originBare, root, target: v110, untagged, upstreamBare, work };
}

function runFixtureUpgrade(fixture, options = {}) {
	return runUpgrade({ allowFileRemotes: true, cwd: fixture.work, ...options });
}

function verificationRecorder() {
	const calls = [];
	return {
		calls,
		runner(commandName, args) {
			calls.push([commandName, ...args]);
			return { status: 0, stderr: "", stdout: "" };
		},
	};
}

test("accepts only secure GitHub repository transports", () => {
	assert.equal(
		canonicalRepositoryId("git@github.com:earendil-works/pi.git"),
		canonicalRepositoryId("https://github.com/earendil-works/pi"),
	);
	assert.equal(
		canonicalRepositoryId("ssh://git@github.com/earendil-works/pi.git"),
		"github.com/earendil-works/pi",
	);
	for (const url of [
		"http://github.com/earendil-works/pi",
		"git://github.com/earendil-works/pi",
		"foo://github.com/earendil-works/pi",
	]) {
		assert.throws(() => canonicalRepositoryId(url), /must use GitHub HTTPS or SSH/);
	}
});

test("reports a newer stable Pi tag without changing the checkout", (t) => {
	const fixture = createFixture(t);
	assert.equal(git(fixture.work, "tag", "--list", "v1.1.0"), "");
	git(fixture.work, "tag", "v9.9.9", fixture.untagged);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	const messages = [];
	const result = runFixtureUpgrade(fixture, { write: (message) => messages.push(message) });

	assert.equal(result.status, "available");
	assert.equal(result.target.commit, fixture.target);
	assert.equal(git(fixture.work, "branch", "--show-current"), "main");
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.equal(git(fixture.work, "status", "--porcelain"), "");
	assert.equal(git(fixture.work, "tag", "--list", "v1.1.0"), "");
	assert.match(messages.join("\n"), /--to 'v1\.1\.0' --apply/);
	assert.match(messages.join("\n"), /--allow-lockfile-change/);
});

test("accepts a full official upstream commit SHA for inspection", (t) => {
	const fixture = createFixture(t);
	const messages = [];
	const result = runFixtureUpgrade(fixture, {
		argv: ["--to", fixture.untagged],
		write: (message) => messages.push(message),
	});
	assert.equal(result.status, "available");
	assert.equal(result.target.commit, fixture.untagged);
	assert.equal(git(fixture.work, "branch", "--show-current"), "main");
	assert.ok(messages.some((message) => message.includes(`--to '${fixture.untagged}' --apply`)));
});

test("shell-quotes an explicit upstream tag in the suggested apply command", (t) => {
	const hostileTag = 'release;touch${IFS}PWNED;#';
	const fixture = createFixture(t, { hostileTag });
	const messages = [];
	const result = runFixtureUpgrade(fixture, {
		argv: ["--to", hostileTag],
		write: (message) => messages.push(message),
	});
	assert.equal(result.status, "available");
	assert.ok(
		messages.some((message) =>
			message.endsWith(`--to ${shellQuote(hostileTag)} --apply --allow-lockfile-change`),
		),
	);
});

test("does not propose an older stable tag when the recorded baseline is newer", (t) => {
	const fixture = createFixture(t, { recordedBaseline: "untagged" });
	const result = runFixtureUpgrade(fixture, { write() {} });
	assert.equal(result.status, "no-update");
	assert.equal(git(fixture.work, "branch", "--show-current"), "main");
});

test("rejects downgrade targets and abbreviated commit ids", (t) => {
	const fixture = createFixture(t, { recordedBaseline: "v1.1.0" });
	assert.throws(() => runFixtureUpgrade(fixture, { argv: ["--to", "v1.0.0"], write() {} }), /Refusing to downgrade/);
	assert.throws(
		() => runFixtureUpgrade(fixture, { argv: ["--to", fixture.untagged.slice(0, 12)], write() {} }),
		/Pi target does not resolve|valid Pi tag/,
	);
});

test("requires clean synchronized main", (t) => {
	const fixture = createFixture(t);
	git(fixture.work, "config", "status.showUntrackedFiles", "no");
	writeFileSync(join(fixture.work, "dirty.txt"), "dirty\n");
	assert.throws(() => runFixtureUpgrade(fixture, { write() {} }), /working tree must be clean/);
	rmSync(join(fixture.work, "dirty.txt"));
	git(fixture.work, "switch", "-c", "feature/not-main");
	assert.throws(() => runFixtureUpgrade(fixture, { write() {} }), /Run this command from main/);
});

test("rejects local Git replacement refs before resolving upstream history", (t) => {
	const fixture = createFixture(t);
	git(fixture.work, "fetch", "upstream", "main");
	git(fixture.work, "replace", fixture.target, fixture.baseline);
	assert.throws(() => runFixtureUpgrade(fixture, { write() {} }), /Remove local Git replacement refs/);
	assert.equal(git(fixture.work, "branch", "--show-current"), "main");
});

test("rejects local Git grafts before resolving upstream history", (t) => {
	const fixture = createFixture(t);
	const rawPath = git(fixture.work, "rev-parse", "--git-path", "info/grafts");
	const graftsPath = isAbsolute(rawPath) ? rawPath : resolve(fixture.work, rawPath);
	write(graftsPath, `${fixture.target} ${fixture.baseline}\n`);
	assert.throws(() => runFixtureUpgrade(fixture, { write() {} }), /Remove local Git grafts/);
	assert.equal(git(fixture.work, "branch", "--show-current"), "main");
});

test("refreshes origin/main explicitly before comparing synchronized main", (t) => {
	const fixture = createFixture(t);
	const updater = join(fixture.root, "origin-updater");
	command(fixture.root, "git", ["clone", fixture.originBare, updater]);
	configureGit(updater);
	write(join(updater, "remote-change.txt"), "remote advanced\n");
	commitAll(updater, "advance remote main");
	git(updater, "push", "origin", "main");
	git(fixture.work, "tag", "origin/main", git(fixture.work, "rev-parse", "HEAD"));
	git(fixture.work, "config", "remote.origin.fetch", "+refs/heads/other:refs/remotes/origin/other");
	assert.throws(() => runFixtureUpgrade(fixture, { write() {} }), /must exactly match origin\/main/);
});

test("refreshes upstream/main explicitly before proving target provenance", (t) => {
	const fixture = createFixture(t);
	runFixtureUpgrade(fixture, { write() {} });
	git(fixture.work, "tag", "upstream/main", fixture.untagged);
	git(fixture.work, "config", "remote.upstream.fetch", "+refs/heads/other:refs/remotes/upstream/other");
	git(fixture.upstreamBare, "update-ref", "refs/heads/main", fixture.baseline);
	assert.throws(
		() => runFixtureUpgrade(fixture, { argv: ["--to", "v1.1.0"], write() {} }),
		/not reachable from the official upstream\/main history/,
	);
});

test("rejects a recorded baseline outside official upstream history", (t) => {
	const fixture = createFixture(t);
	const downstreamCommit = git(fixture.work, "rev-parse", "HEAD");
	const metadataPath = join(fixture.work, "packages/byz/upstream.json");
	const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
	metadata.commit = downstreamCommit;
	writeFileSync(metadataPath, `${JSON.stringify(metadata, null, "\t")}\n`);
	git(fixture.work, "add", "packages/byz/upstream.json");
	git(fixture.work, "commit", "-m", "record invalid downstream baseline");
	git(fixture.work, "push", "origin", "main");
	assert.throws(() => runFixtureUpgrade(fixture, { write() {} }), /not part of the official upstream\/main history/);
});

test("requires an explicit target before apply", () => {
	assert.throws(() => runUpgrade({ argv: ["--apply"], write() {} }), /requires an explicit --to/);
	assert.throws(
		() => runUpgrade({ argv: ["--allow-lockfile-change"], write() {} }),
		/valid only with --apply/,
	);
});

test("requires explicit authorization before applying dependency metadata changes", (t) => {
	const fixture = createFixture(t);
	assert.throws(
		() => runFixtureUpgrade(fixture, { argv: ["--to", "v1.1.0", "--apply"], write() {} }),
		/changes dependency metadata.*--allow-lockfile-change/,
	);
	assert.equal(git(fixture.work, "branch", "--show-current"), "main");
});

test("rejects a false merge when the target is already in BYZ main", (t) => {
	const fixture = createFixture(t, { checkoutBase: "v1.1.0", recordedBaseline: "v1.0.0" });
	const result = runFixtureUpgrade(fixture, { argv: ["--to", "v1.1.0"], write() {} });
	assert.equal(result.status, "already-integrated");
	assert.throws(
		() => runFixtureUpgrade(fixture, { argv: ["--to", "v1.1.0", "--apply"], write() {} }),
		/already contained in BYZ main/,
	);
	assert.equal(git(fixture.work, "branch", "--show-current"), "main");
});

test("applies a verified upgrade as a local merge commit without touching origin", (t) => {
	const fixture = createFixture(t);
	const preCommitHook = join(fixture.work, ".git/hooks/pre-commit");
	write(preCommitHook, '#!/bin/sh\n[ "$PI_ALLOW_LOCKFILE_CHANGE" = "1" ] || exit 42\n');
	chmodSync(preCommitHook, 0o755);
	const originBefore = git(fixture.originBare, "rev-parse", "main");
	const verifier = verificationRecorder();
	const result = runFixtureUpgrade(fixture, {
		argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
		now: () => new Date("2026-08-26T12:00:00Z"),
		verificationRunner: verifier.runner,
		write() {},
	});

	assert.equal(result.status, "applied");
	assert.equal(git(fixture.work, "branch", "--show-current"), "upgrade/pi-v1.1.0");
	assert.equal(git(fixture.work, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3);
	assert.equal(git(fixture.originBare, "rev-parse", "main"), originBefore);
	assert.equal(git(fixture.work, "status", "--porcelain"), "");
	assert.deepEqual(verifier.calls, [
		["npm", "install", "--ignore-scripts"],
		["npm", "run", "build:byz"],
		["npm", "run", "check"],
		["npm", "--prefix", "packages/byz", "test"],
	]);
	const metadata = JSON.parse(readFileSync(join(fixture.work, "packages/byz/upstream.json"), "utf8"));
	assert.equal(metadata.commit, fixture.target);
	assert.equal(metadata.codingAgentVersion, "1.1.0");
	assert.equal(metadata.checkedAt, "2026-08-26");
	assert.match(readFileSync(join(fixture.work, "packages/byz/src/cli.js"), "utf8"), /update/);
	assert.equal(readFileSync(join(fixture.work, "packages/byz/workflows.lock.json"), "utf8"), '{"cm":"locked","cm-plugin":"separate"}\n');
});

test("does not commit an upgrade when verification fails", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner(commandName, args) {
					if (args.join(" ") === "run check") throw new Error(`${commandName} check failed`);
					return { status: 0, stderr: "", stdout: "" };
				},
				write() {},
			}),
		/npm check failed/,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.ok(hasMergeHead(fixture.work));
});

test("does not commit if verification clears the merge state", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	git(fixture.work, "tag", "MERGE_HEAD", fixture.target);
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner(_commandName, args) {
					if (args.join(" ") === "run check") git(fixture.work, "merge", "--quit");
					return { status: 0, stderr: "", stdout: "" };
				},
				write() {},
			}),
		/does not have the required Pi merge state/,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.equal(hasMergeHead(fixture.work), false);
	assert.equal(git(fixture.work, "rev-parse", "refs/tags/MERGE_HEAD"), fixture.target);
});

test("does not commit upstream metadata changed by verification", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner(_commandName, args) {
					if (args.join(" ") === "run check") {
						const metadataPath = join(fixture.work, "packages/byz/upstream.json");
						const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
						metadata.commit = fixture.baseline;
						writeFileSync(metadataPath, `${JSON.stringify(metadata, null, "\t")}\n`);
					}
					return { status: 0, stderr: "", stdout: "" };
				},
				write() {},
			}),
		/upstream\.json changed during verification/,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.ok(hasMergeHead(fixture.work));
});

test("rejects protected BYZ changes made by verification", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner(_commandName, args) {
					if (args.join(" ") === "run check") {
						writeFileSync(join(fixture.work, "packages/byz/src/cli.js"), "update guard removed\n");
					}
					return { status: 0, stderr: "", stdout: "" };
				},
				write() {},
			}),
		/Protected BYZ file changed during the Pi merge/,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.ok(hasMergeHead(fixture.work));
});

test("rejects unreviewed BYZ build boundary changes made by verification", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner(_commandName, args) {
					if (args.join(" ") === "run check") {
						writeFileSync(join(fixture.work, "packages/byz/scripts/build.mjs"), 'console.log("leak");\n');
					}
					return { status: 0, stderr: "", stdout: "" };
				},
				write() {},
			}),
		/Protected BYZ file changed during the Pi merge/,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.ok(hasMergeHead(fixture.work));
});

test("rejects lockfile side effects introduced after dependency installation", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner(_commandName, args) {
					if (args.join(" ") === "run check") {
						writeFileSync(join(fixture.work, "package-lock.json"), '{"lockfileVersion":3,"version":"tampered"}\n');
					}
					return { status: 0, stderr: "", stdout: "" };
				},
				write() {},
			}),
		/Repository files changed during verification/,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.ok(hasMergeHead(fixture.work));
});

test("does not create a commit when a pre-commit hook clears the real merge state", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	git(fixture.work, "tag", "MERGE_HEAD", fixture.target);
	const preCommitHook = join(fixture.work, ".git/hooks/pre-commit");
	write(preCommitHook, "#!/bin/sh\ngit merge --quit\n");
	chmodSync(preCommitHook, 0o755);
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner: verificationRecorder().runner,
				write() {},
			}),
		/does not have the required Pi merge state/,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.equal(hasMergeHead(fixture.work), false);
	assert.equal(git(fixture.work, "rev-parse", "refs/tags/MERGE_HEAD"), fixture.target);
});

test("rejects BYZ executable-bit changes made during dependency installation", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner(_commandName, args) {
					if (args.join(" ") === "install --ignore-scripts") {
						chmodSync(join(fixture.work, "packages/byz/src/cli.js"), 0o755);
					}
					return { status: 0, stderr: "", stdout: "" };
				},
				write() {},
			}),
		/Protected BYZ file changed during the Pi merge/,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.ok(hasMergeHead(fixture.work));
});

test("does not create a commit when a commit hook leaves an untracked file", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	const preCommitHook = join(fixture.work, ".git/hooks/pre-commit");
	write(preCommitHook, "#!/bin/sh\nprintf leak > hook-side-effect.txt\n");
	chmodSync(preCommitHook, 0o755);
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner: verificationRecorder().runner,
				write() {},
			}),
		/Verification left untracked files.*hook-side-effect\.txt/s,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.ok(hasMergeHead(fixture.work));
});

test("does not let textconv hide a staged commit-hook side effect", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	const textconv = join(fixture.root, "constant-textconv.sh");
	write(textconv, "#!/bin/sh\nprintf 'constant\\n'\n");
	chmodSync(textconv, 0o755);
	git(fixture.work, "config", "diff.constant.textconv", textconv);
	write(join(fixture.work, ".git/info/attributes"), "shared.txt diff=constant\n");
	const preCommitHook = join(fixture.work, ".git/hooks/pre-commit");
	write(preCommitHook, "#!/bin/sh\nprintf 'hook-tampered\\n' > shared.txt\ngit add shared.txt\n");
	chmodSync(preCommitHook, 0o755);

	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner: verificationRecorder().runner,
				write() {},
			}),
		/Repository files changed during verification|Commit hooks changed or unstaged the verified Pi upgrade patch/,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.ok(hasMergeHead(fixture.work));
});

test("rejects executable upstream metadata introduced during dependency installation", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner(_commandName, args) {
					if (args.join(" ") === "install --ignore-scripts") {
						chmodSync(join(fixture.work, "packages/byz/upstream.json"), 0o755);
					}
					return { status: 0, stderr: "", stdout: "" };
				},
				write() {},
			}),
		/upstream\.json file structure changed/,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.ok(hasMergeHead(fixture.work));
});

test("rejects upstream metadata replaced with a symlink", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner(_commandName, args) {
					if (args.join(" ") === "install --ignore-scripts") {
						const metadataPath = join(fixture.work, "packages/byz/upstream.json");
						rmSync(metadataPath);
						symlinkSync("workflows.lock.json", metadataPath);
					}
					return { status: 0, stderr: "", stdout: "" };
				},
				write() {},
			}),
		/upstream\.json file structure changed/,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.ok(hasMergeHead(fixture.work));
});

test("rejects index-only mode changes to upstream metadata", (t) => {
	const fixture = createFixture(t);
	const beforeHead = git(fixture.work, "rev-parse", "HEAD");
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner(_commandName, args) {
					if (args.join(" ") === "run check") {
						git(fixture.work, "update-index", "--chmod=+x", "packages/byz/upstream.json");
					}
					return { status: 0, stderr: "", stdout: "" };
				},
				write() {},
			}),
		/upstream\.json file structure changed/,
	);
	assert.equal(git(fixture.work, "rev-parse", "HEAD"), beforeHead);
	assert.ok(hasMergeHead(fixture.work));
});

test("stops on merge conflicts without updating the recorded baseline", (t) => {
	const fixture = createFixture(t, { conflict: true });
	const verifier = verificationRecorder();
	assert.throws(
		() =>
			runFixtureUpgrade(fixture, {
				argv: ["--to", "v1.1.0", "--apply", "--allow-lockfile-change"],
				verificationRunner: verifier.runner,
				write() {},
			}),
		/Pi merge has conflicts/,
	);

	assert.equal(git(fixture.work, "branch", "--show-current"), "upgrade/pi-v1.1.0");
	assert.ok(hasMergeHead(fixture.work));
	assert.equal(verifier.calls.length, 0);
	const metadata = JSON.parse(readFileSync(join(fixture.work, "packages/byz/upstream.json"), "utf8"));
	assert.equal(metadata.commit, fixture.baseline);
});
