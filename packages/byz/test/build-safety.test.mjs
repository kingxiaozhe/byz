import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
	acquireBuildLock,
	ensureSafeOutputRoot,
	portablePackagePathKey,
	publishPackageImage,
	resolveCurrentPackageImage,
	validateCompiledOutputPaths,
	validateWorkflowBundlePath,
	validateWorkflowBundlePaths,
} from "../scripts/build-support.mjs";

async function writeFixture(path, content) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
}

function createFakeProcessIdentityProbe(initialIdentity) {
	let currentIdentity = { ...initialIdentity };
	const observations = new Map();
	const key = (pid, processStartId) => `${pid}:${processStartId}`;
	return {
		async current() {
			return { ...currentIdentity };
		},
		async inspect(pid, expectedStartId) {
			const overridden = observations.get(key(pid, expectedStartId));
			if (overridden) return overridden;
			if (pid !== currentIdentity.pid) return "absent";
			return expectedStartId === currentIdentity.processStartId ? "same" : "different";
		},
		setCurrent(identity) {
			currentIdentity = { ...identity };
		},
		setObservation(identity, state) {
			const observationKey = key(identity.pid, identity.processStartId);
			if (state) observations.set(observationKey, state);
			else observations.delete(observationKey);
		},
	};
}

test("rejects a symlink output root before writing or cleaning outside the package", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-output-boundary-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	const packageDir = join(root, "package");
	const outsideDir = join(root, "outside");
	await Promise.all([mkdir(packageDir), mkdir(outsideDir)]);
	await writeFile(join(outsideDir, "keep.txt"), "keep\n");
	const outputDir = join(packageDir, ".byz-output");
	await symlink(outsideDir, outputDir, "dir");

	await assert.rejects(ensureSafeOutputRoot(outputDir, packageDir), /must be a real directory/);
	await assert.rejects(
		acquireBuildLock(outputDir, {
			packageDir,
			processIdentityProbe: createFakeProcessIdentityProbe({ pid: 100, processStartId: "start-a" }),
		}),
		/must be a real directory/,
	);
	assert.equal(await readFile(join(outsideDir, "keep.txt"), "utf8"), "keep\n");
});

test("rejects a symlink generations root before any generation write", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-generations-boundary-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	const packageDir = join(root, "package");
	const outputDir = join(packageDir, ".byz-output");
	const outsideDir = join(root, "outside");
	await Promise.all([mkdir(outputDir, { recursive: true }), mkdir(outsideDir)]);
	await writeFile(join(outsideDir, "keep.txt"), "keep\n");
	await symlink(outsideDir, join(outputDir, "generations"), "dir");
	await assert.rejects(
		acquireBuildLock(outputDir, {
			packageDir,
			processIdentityProbe: createFakeProcessIdentityProbe({ pid: 100, processStartId: "start-a" }),
		}),
		/BYZ generations root must be a real directory/,
	);
	assert.equal(await readFile(join(outsideDir, "keep.txt"), "utf8"), "keep\n");
});

test("rejects portable workflow aliases and ancestor overlap", () => {
	assert.equal(validateWorkflowBundlePath("workflows/cm"), "workflows/cm");
	assert.equal(validateWorkflowBundlePath("workflows\\cm-plugin"), "workflows/cm-plugin");
	assert.deepEqual(validateWorkflowBundlePaths(["workflows/cm-plugin", "workflows/cm"]), [
		"workflows/cm",
		"workflows/cm-plugin",
	]);
	for (const paths of [
		["workflows/cm", "workflows/cm"],
		["workflows/cm", "workflows/cm/plugin"],
		["workflows/a", "workflows/A/b"],
	]) {
		assert.throws(() => validateWorkflowBundlePaths(paths), /Overlapping workflow bundle paths/);
	}
	assert.throws(() => validateWorkflowBundlePath("workflows"), /Unsafe workflow bundle path/);
	for (const path of [
		"workflows/cm. ",
		"workflows/cm:plugin",
		"workflows/é",
		"workflows/e\u0301",
		"workflows/Σ",
		"workflows/ς",
		"workflows/COM¹",
	]) {
		assert.throws(() => validateWorkflowBundlePath(path), /not portable/);
	}
});

test("uses one portable namespace for compiled output and reserved runtime paths", () => {
	assert.equal(portablePackagePathKey("core/export-html/Template.js"), "core/export-html/template.js");
	for (const path of ["ｃore/export-html/template.js", "core./export-html/template.js", "aux/file.js"]) {
		assert.throws(() => portablePackagePathKey(path, "Compiled BYZ output path"), /not portable/);
	}
	assert.throws(
		() => validateCompiledOutputPaths(["core/export-html/Template.js"], ["core/export-html/template.js"]),
		/portable path conflicts/,
	);
	assert.throws(() => validateCompiledOutputPaths(["Runtime/bundle/index.js"], []), /reserved Pi runtime tree/);
	assert.throws(() => validateCompiledOutputPaths(["Probe.js", "probe.js"], []), /overlapping portable paths/);
	assert.throws(
		() => validateCompiledOutputPaths(["A.js", "a.js-foo.js", "a.js/b.js"], []),
		/overlapping portable paths/,
	);
});

test("never takes a lock from the same live process identity", async (t) => {
	const packageDir = await mkdtemp(join(tmpdir(), "byz-live-build-lock-"));
	t.after(() => rm(packageDir, { force: true, recursive: true }));
	const outputDir = join(packageDir, ".byz-output");
	const probe = createFakeProcessIdentityProbe({ pid: 100, processStartId: "start-a" });
	const first = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	await assert.rejects(
		acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe }),
		/Another BYZ build is active/,
	);
	await first.assertOwner();
	assert.equal(await first(), true);
});

test("recovers only after process absence or PID start-identity reuse", async (t) => {
	const packageDir = await mkdtemp(join(tmpdir(), "byz-dead-build-lock-"));
	t.after(() => rm(packageDir, { force: true, recursive: true }));
	const outputDir = join(packageDir, ".byz-output");
	const firstIdentity = { pid: 100, processStartId: "start-a" };
	const secondIdentity = { pid: 101, processStartId: "start-b" };
	const probe = createFakeProcessIdentityProbe(firstIdentity);
	const first = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	probe.setObservation(firstIdentity, "absent");
	probe.setCurrent(secondIdentity);
	const second = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	await assert.rejects(first.assertOwner(), /(?:ownership was lost|process identity changed)/);
	assert.equal(await first(), false);
	await second.assertOwner();
	assert.equal(await second(), true);

	probe.setObservation(firstIdentity, undefined);
	probe.setCurrent(firstIdentity);
	const reused = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	probe.setCurrent({ pid: 100, processStartId: "start-c" });
	const replacement = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	await assert.rejects(reused.assertOwner(), /(?:ownership was lost|process identity changed)/);
	assert.equal(await reused(), false);
	assert.equal(await replacement(), true);
});

test("fails closed when process identity cannot be determined", async (t) => {
	const packageDir = await mkdtemp(join(tmpdir(), "byz-unknown-build-lock-"));
	t.after(() => rm(packageDir, { force: true, recursive: true }));
	const outputDir = join(packageDir, ".byz-output");
	const identity = { pid: 100, processStartId: "start-a" };
	const probe = createFakeProcessIdentityProbe(identity);
	const first = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	probe.setObservation(identity, "unknown");
	await assert.rejects(
		acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe }),
		/Cannot safely determine/,
	);
	probe.setObservation(identity, undefined);
	await first.assertOwner();
	assert.equal(await first(), true);
});

test("fails closed when a competing owner becomes unknown after activation", async (t) => {
	const packageDir = await mkdtemp(join(tmpdir(), "byz-post-activation-unknown-"));
	t.after(() => rm(packageDir, { force: true, recursive: true }));
	const outputDir = join(packageDir, ".byz-output");
	const firstIdentity = { pid: 100, processStartId: "start-a" };
	const secondIdentity = { pid: 101, processStartId: "start-b" };
	const firstInspectionStarted = Promise.withResolvers();
	const continueFirstInspection = Promise.withResolvers();
	let blockFirstInspection = true;
	const firstProbe = {
		async current() {
			return firstIdentity;
		},
		async inspect(_pid, processStartId) {
			if (processStartId === firstIdentity.processStartId) {
				if (blockFirstInspection) {
					blockFirstInspection = false;
					firstInspectionStarted.resolve();
					await continueFirstInspection.promise;
				}
				return "same";
			}
			return processStartId === secondIdentity.processStartId ? "unknown" : "absent";
		},
	};
	const secondProbe = {
		async current() {
			return secondIdentity;
		},
		async inspect(_pid, processStartId) {
			return processStartId === secondIdentity.processStartId ? "same" : "absent";
		},
	};

	const firstAttempt = acquireBuildLock(outputDir, { packageDir, processIdentityProbe: firstProbe });
	await firstInspectionStarted.promise;
	const second = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: secondProbe });
	continueFirstInspection.resolve();
	await assert.rejects(firstAttempt, /Cannot safely determine/);
	await second.assertOwner();
	assert.equal(await second(), true);
});

test("ignores an interrupted candidate until complete owner metadata is atomically installed", async (t) => {
	const packageDir = await mkdtemp(join(tmpdir(), "byz-build-interruption-"));
	t.after(() => rm(packageDir, { force: true, recursive: true }));
	const outputDir = join(packageDir, ".byz-output");
	await mkdir(join(outputDir, ".build-locks-v3", ".candidate-interrupted"), { recursive: true });
	const probe = createFakeProcessIdentityProbe({ pid: 100, processStartId: "start-a" });
	const lock = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	await lock.assertOwner();
	assert.equal(await lock(), true);
});

test("detects output-directory replacement before later lock or publication writes", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-build-replacement-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	const packageDir = join(root, "package");
	const outsideDir = join(root, "outside");
	await Promise.all([mkdir(packageDir), mkdir(outsideDir)]);
	await writeFile(join(outsideDir, "keep.txt"), "keep\n");
	const outputDir = join(packageDir, ".byz-output");
	const probe = createFakeProcessIdentityProbe({ pid: 100, processStartId: "start-a" });
	const lock = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	const generationDir = join(outputDir, "generations", "first");
	const imageDir = join(generationDir, "package");
	await writeFixture(join(imageDir, "marker.txt"), "first");
	await rename(outputDir, join(packageDir, ".byz-output-moved"));
	await symlink(outsideDir, outputDir, "dir");

	await assert.rejects(lock.assertOwner(), /output root changed/);
	await assert.rejects(
		publishPackageImage({
			generationDir: join(packageDir, ".byz-output-moved", "generations", "first"),
			imageDir: join(packageDir, ".byz-output-moved", "generations", "first", "package"),
			outputDir,
			lock,
		}),
		/(?:output root changed|generation escaped)/,
	);
	assert.equal(await lock(), false);
	assert.equal(await readFile(join(outsideDir, "keep.txt"), "utf8"), "keep\n");
});

test("allows exactly one concurrent recovery after the old process is absent", async (t) => {
	const packageDir = await mkdtemp(join(tmpdir(), "byz-build-contenders-"));
	t.after(() => rm(packageDir, { force: true, recursive: true }));
	const outputDir = join(packageDir, ".byz-output");
	const oldIdentity = { pid: 100, processStartId: "start-a" };
	const newIdentity = { pid: 101, processStartId: "start-b" };
	const probe = createFakeProcessIdentityProbe(oldIdentity);
	const expired = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	probe.setObservation(oldIdentity, "absent");
	probe.setCurrent(newIdentity);
	const attempts = await Promise.allSettled(
		Array.from({ length: 8 }, () => acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe })),
	);
	const winners = attempts.filter((result) => result.status === "fulfilled").map((result) => result.value);
	assert.equal(winners.length, 1);
	await winners[0].assertOwner();
	assert.equal(await expired(), false);
	assert.equal(await winners[0](), true);
});

test("fences publication when a stale complete owner becomes unknown", async (t) => {
	const packageDir = await mkdtemp(join(tmpdir(), "byz-publication-unknown-"));
	t.after(() => rm(packageDir, { force: true, recursive: true }));
	const outputDir = join(packageDir, ".byz-output");
	const firstIdentity = { pid: 100, processStartId: "start-a" };
	const secondIdentity = { pid: 101, processStartId: "start-b" };
	const probe = createFakeProcessIdentityProbe(firstIdentity);
	const first = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	probe.setObservation(firstIdentity, "absent");
	probe.setCurrent(secondIdentity);
	const second = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	const generationDir = join(outputDir, "generations", "second");
	const imageDir = join(generationDir, "package");
	await writeFixture(join(imageDir, "marker.txt"), "second");

	probe.setObservation(firstIdentity, "unknown");
	await assert.rejects(second.assertOwner(), /Cannot safely determine/);
	await assert.rejects(
		publishPackageImage({ generationDir, imageDir, outputDir, lock: second }),
		/Cannot safely determine/,
	);
	probe.setObservation(firstIdentity, "absent");
	assert.equal(await first(), false);
	assert.equal(await second(), true);
});

test("reports a completed pointer rename when the post-publication fence becomes unknown", async (t) => {
	const packageDir = await mkdtemp(join(tmpdir(), "byz-post-publication-unknown-"));
	t.after(() => rm(packageDir, { force: true, recursive: true }));
	const outputDir = join(packageDir, ".byz-output");
	const firstIdentity = { pid: 100, processStartId: "start-a" };
	const secondIdentity = { pid: 101, processStartId: "start-b" };
	const first = await acquireBuildLock(outputDir, {
		packageDir,
		processIdentityProbe: createFakeProcessIdentityProbe(firstIdentity),
	});
	const generationDir = join(outputDir, "generations", "second");
	const imageDir = join(generationDir, "package");
	await writeFixture(join(imageDir, "marker.txt"), "second");
	const secondProbe = {
		async current() {
			return secondIdentity;
		},
		async inspect(_pid, processStartId) {
			if (processStartId === secondIdentity.processStartId) return "same";
			if (processStartId !== firstIdentity.processStartId) return "absent";
			try {
				return (await realpath(join(outputDir, "current"))) === (await realpath(imageDir)) ? "unknown" : "absent";
			} catch (error) {
				if (error?.code === "ENOENT") return "absent";
				throw error;
			}
		},
	};
	const second = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: secondProbe });
	const expectedPointer = join(await realpath(outputDir), "current");

	await assert.rejects(publishPackageImage({ generationDir, imageDir, outputDir, lock: second }), (error) => {
		assert.equal(error.name, "PackagePublicationError");
		assert.equal(error.publicationState, "promoted-unconfirmed");
		assert.equal(error.pointer, expectedPointer);
		return true;
	});
	assert.equal(await realpath(join(outputDir, "current")), await realpath(imageDir));
	assert.equal(await second(), false);
	assert.equal(await first(), true);
});

test("prevents the dead owner's handle from publishing or releasing after recovery", async (t) => {
	const packageDir = await mkdtemp(join(tmpdir(), "byz-build-publication-lock-"));
	t.after(() => rm(packageDir, { force: true, recursive: true }));
	const outputDir = join(packageDir, ".byz-output");
	const firstIdentity = { pid: 100, processStartId: "start-a" };
	const secondIdentity = { pid: 101, processStartId: "start-b" };
	const probe = createFakeProcessIdentityProbe(firstIdentity);
	const first = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	const firstGeneration = join(outputDir, "generations", "first");
	const firstImage = join(firstGeneration, "package");
	await writeFixture(join(firstImage, "marker.txt"), "first");
	probe.setObservation(firstIdentity, "absent");
	probe.setCurrent(secondIdentity);
	const second = await acquireBuildLock(outputDir, { packageDir, processIdentityProbe: probe });
	const secondGeneration = join(outputDir, "generations", "second");
	const secondImage = join(secondGeneration, "package");
	await writeFixture(join(secondImage, "marker.txt"), "second");

	await assert.rejects(
		publishPackageImage({ generationDir: firstGeneration, imageDir: firstImage, outputDir, lock: first }),
		/(?:ownership was lost|process identity changed)/,
	);
	await publishPackageImage({ generationDir: secondGeneration, imageDir: secondImage, outputDir, lock: second });
	assert.equal(await readFile(join(await resolveCurrentPackageImage(outputDir), "marker.txt"), "utf8"), "second");
	assert.equal(await first(), false);
	assert.equal(await second(), true);
	await assert.rejects(first.assertOwner());
});
