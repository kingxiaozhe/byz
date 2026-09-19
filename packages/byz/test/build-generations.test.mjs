import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { pruneSupersededGenerations, retainedGenerationCount } from "../scripts/build.mjs";

// Generation names are random, so retention orders them by build time.
async function writeGeneration(generationsRoot, name, modifiedAt) {
	const generationDir = join(generationsRoot, name);
	const imageDir = join(generationDir, "package", "dist");
	await mkdir(imageDir, { recursive: true });
	await writeFile(join(imageDir, "cli.js"), "#!/usr/bin/env node\n");
	await utimes(generationDir, modifiedAt, modifiedAt);
	return generationDir;
}

async function createOutputRoot(names) {
	const outputDir = await mkdtemp(join(tmpdir(), "byz-generations-"));
	const generationsRoot = join(outputDir, "generations");
	await mkdir(generationsRoot, { recursive: true });
	for (const [index, name] of names.entries()) {
		await writeGeneration(generationsRoot, name, 1_000 + index);
	}
	return { generationsRoot, outputDir };
}

async function promote(outputDir, generationsRoot, name) {
	const image = join(generationsRoot, name, "package");
	await symlink(relative(outputDir, image), join(outputDir, "current"), "dir");
}

async function remaining(generationsRoot) {
	return (await readdir(generationsRoot)).sort();
}

test("keeps the current generation plus the most recent superseded ones", async () => {
	// generation-e is newest, generation-a oldest; generation-c is promoted.
	const names = ["generation-a", "generation-b", "generation-c", "generation-d", "generation-e"];
	const { generationsRoot, outputDir } = await createOutputRoot(names);
	try {
		await promote(outputDir, generationsRoot, "generation-c");

		const pruned = await pruneSupersededGenerations({ generationsRoot, keep: 3, outputDir });

		assert.equal(pruned.length, 2);
		assert.deepEqual(await remaining(generationsRoot), ["generation-c", "generation-d", "generation-e"]);
	} finally {
		await rm(outputDir, { force: true, recursive: true });
	}
});

test("never removes the promoted generation, even when it is the oldest", async () => {
	const names = ["generation-a", "generation-b", "generation-c"];
	const { generationsRoot, outputDir } = await createOutputRoot(names);
	try {
		await promote(outputDir, generationsRoot, "generation-a");

		await pruneSupersededGenerations({ generationsRoot, keep: 1, outputDir });

		assert.deepEqual(await remaining(generationsRoot), ["generation-a"]);
	} finally {
		await rm(outputDir, { force: true, recursive: true });
	}
});

test("leaves unrelated entries in the generations root alone", async () => {
	const { generationsRoot, outputDir } = await createOutputRoot(["generation-a", "generation-b"]);
	try {
		await promote(outputDir, generationsRoot, "generation-b");
		await writeFile(join(generationsRoot, "notes.txt"), "not a generation\n");
		await mkdir(join(generationsRoot, "scratch"), { recursive: true });

		await pruneSupersededGenerations({ generationsRoot, keep: 1, outputDir });

		assert.deepEqual(await remaining(generationsRoot), ["generation-b", "notes.txt", "scratch"]);
	} finally {
		await rm(outputDir, { force: true, recursive: true });
	}
});

test("refuses to prune when the current pointer is not a valid generation package", async () => {
	const { generationsRoot, outputDir } = await createOutputRoot(["generation-a", "generation-b"]);
	try {
		await mkdir(join(outputDir, "current"), { recursive: true });

		await assert.rejects(() => pruneSupersededGenerations({ generationsRoot, keep: 1, outputDir }));
		assert.deepEqual(await remaining(generationsRoot), ["generation-a", "generation-b"]);
	} finally {
		await rm(outputDir, { force: true, recursive: true });
	}
});

test("reads the retention count from the environment and rejects invalid values", () => {
	assert.equal(retainedGenerationCount(undefined), 3);
	assert.equal(retainedGenerationCount(""), 3);
	assert.equal(retainedGenerationCount("1"), 1);
	assert.equal(retainedGenerationCount("10"), 10);
	for (const value of ["0", "-1", "2.5", "many"]) {
		assert.throws(() => retainedGenerationCount(value), /BYZ_KEEP_GENERATIONS must be a positive integer\./);
	}
});
