import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildByzPackage, createPublishedPackageJson } from "../scripts/build.mjs";
import {
	acquireBuildLock,
	publishPackageImage,
	resolveCurrentPackageImage,
	validateBuildManifest,
	validatePackageImage,
	validateWorkflowBundlePath,
} from "../scripts/build-support.mjs";

const repositoryDir = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const byzPackageDir = join(repositoryDir, "packages", "byz");

async function writeFixture(path, content) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
}

async function writeJson(path, value) {
	await writeFixture(path, `${JSON.stringify(value, null, "\t")}\n`);
}

test("atomically switches one current pointer between complete generations", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-build-generation-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	const outputDir = join(root, "output");
	await mkdir(outputDir, { recursive: true });
	const lock = await acquireBuildLock(outputDir);
	try {
		for (const name of ["first", "second"]) {
			const generationDir = join(outputDir, "generations", name);
			const imageDir = join(generationDir, "package");
			await writeFixture(join(imageDir, "marker.txt"), name);
			const publication = await publishPackageImage({ generationDir, imageDir, outputDir, lock });
			assert.equal(publication.publicationState, "promoted-confirmed");
			assert.equal(await readFile(join(await resolveCurrentPackageImage(outputDir), "marker.txt"), "utf8"), name);
		}
		assert.equal(await readFile(join(outputDir, "generations", "first", "package", "marker.txt"), "utf8"), "first");
	} finally {
		await lock();
	}
});

test("serializes builds with a recoverable process-owned lock", async (t) => {
	const outputDir = await mkdtemp(join(tmpdir(), "byz-build-lock-"));
	t.after(() => rm(outputDir, { force: true, recursive: true }));
	const release = await acquireBuildLock(outputDir);
	await assert.rejects(acquireBuildLock(outputDir), /Another BYZ build is active/);
	await release();
	const releaseAgain = await acquireBuildLock(outputDir);
	await releaseAgain();
});

test("production orchestration builds complete generations and preserves current through contention and failure", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "byz-production-build-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	const packageDir = join(root, "packages", "byz");
	const codingAgentDir = join(root, "packages", "coding-agent");
	const outputDir = join(packageDir, ".byz-output");
	const [manifest, workspacePackageJson, buildConfig, baseConfig] = await Promise.all([
		readFile(join(byzPackageDir, "build-manifest.json"), "utf8").then(JSON.parse),
		readFile(join(byzPackageDir, "package.json"), "utf8").then(JSON.parse),
		readFile(join(byzPackageDir, "tsconfig.build.json"), "utf8"),
		readFile(join(repositoryDir, "tsconfig.base.json"), "utf8").then(JSON.parse),
	]);
	const workflowSource = "file:node_modules/@fixture/workflow";
	workspacePackageJson.devDependencies = {
		...workspacePackageJson.devDependencies,
		"@fixture/workflow": workflowSource,
	};
	await Promise.all([
		writeJson(join(packageDir, "build-manifest.json"), manifest),
		writeJson(join(packageDir, "package.json"), workspacePackageJson),
		writeJson(join(packageDir, "workflows.lock.json"), {
			workflows: {
				fixture: {
					bundled: true,
					bundledPath: "workflows/fixture",
					license: "MIT",
					packageName: "@fixture/workflow",
					source: workflowSource,
					version: "1.0.0",
				},
			},
		}),
		writeJson(join(packageDir, "upstream.json"), {}),
		writeFixture(join(packageDir, "tsconfig.build.json"), buildConfig),
		writeJson(join(root, "tsconfig.base.json"), {
			...baseConfig,
			compilerOptions: {
				...baseConfig.compilerOptions,
				typeRoots: [join(repositoryDir, "node_modules", "@types")],
			},
		}),
		writeFixture(join(packageDir, "CHANGELOG.md"), "# Changelog\n"),
		writeFixture(join(packageDir, "LICENSE"), "MIT\n"),
		writeFixture(join(packageDir, "README.md"), "# Fixture\n"),
		writeFixture(join(packageDir, "src", "cli.js"), '#!/usr/bin/env node\nexport const cli = "fixture";\n'),
		writeFixture(join(packageDir, "src", "nested", "probe.ts"), 'export const probe = "included";\n'),
		writeJson(join(packageDir, "node_modules", "@fixture", "workflow", "package.json"), {
			license: "MIT",
			name: "@fixture/workflow",
			version: "1.0.0",
		}),
		writeFixture(join(packageDir, "node_modules", "@fixture", "workflow", "marker.txt"), "workflow\n"),
		writeFixture(join(codingAgentDir, "dist", "bundle", "index.js"), "export {};\n"),
		writeFixture(join(codingAgentDir, "dist", "bundle", "rpc-entry.js"), "export {};\n"),
		writeFixture(join(codingAgentDir, "dist", "index.d.ts"), "export {};\n"),
		writeFixture(join(codingAgentDir, "docs", "README.md"), "docs\n"),
		writeFixture(join(codingAgentDir, "examples", "README.md"), "examples\n"),
		...manifest.runtimeAssets.map((asset) => writeFixture(join(codingAgentDir, "dist", asset), "asset\n")),
	]);
	const options = {
		codingAgentDir,
		compilerPath: join(repositoryDir, "node_modules", ".bin", "tsgo"),
		packageDir,
		repositoryDir: root,
	};

	const first = await buildByzPackage(options);
	const firstImage = await realpath(first.imageDir);
	assert.equal(await realpath(join(outputDir, "current")), firstImage);
	assert.match(await readFile(join(firstImage, "dist", "nested", "probe.js"), "utf8"), /probe = "included"/);
	assert.equal(await readFile(join(firstImage, "workflows", "fixture", "marker.txt"), "utf8"), "workflow\n");
	for (const rootName of manifest.generatedRoots)
		assert.equal((await realpath(join(firstImage, rootName))).length > 0, true);

	const sourceTargets = [
		workspacePackageJson.bin.byz,
		workspacePackageJson.main,
		workspacePackageJson.types,
		workspacePackageJson.exports["."].import,
		workspacePackageJson.exports["."].types,
		workspacePackageJson.exports["./rpc-entry"].import,
	];
	for (const target of sourceTargets) {
		assert.match(target, /^(?:\.\/)?\.byz-output\/current\//);
		assert.equal((await realpath(join(packageDir, target))).startsWith(`${firstImage}${sep}`), true);
	}
	const publishedPackageJson = JSON.parse(await readFile(join(firstImage, "package.json"), "utf8"));
	assert.equal(publishedPackageJson.bin.byz, "dist/cli.js");
	assert.equal(publishedPackageJson.main, "./dist/runtime/bundle/index.js");
	assert.equal(publishedPackageJson.types, "./dist/runtime/index.d.ts");
	assert.doesNotMatch(JSON.stringify(publishedPackageJson), /\.byz-output/);

	await assert.rejects(
		buildByzPackage({ ...options, outputDir: join(packageDir, "other-output") }),
		/BYZ output root is fixed/,
	);
	assert.equal(await realpath(join(outputDir, "current")), firstImage);

	const outsideWorkflowFile = join(root, "outside-workflow.txt");
	const escapedWorkflowLink = join(packageDir, "node_modules", "@fixture", "workflow", "escaped.txt");
	await writeFixture(outsideWorkflowFile, "outside\n");
	await symlink(outsideWorkflowFile, escapedWorkflowLink);
	await assert.rejects(buildByzPackage(options), /Workflow package @fixture\/workflow contains a symbolic link/);
	await rm(escapedWorkflowLink);
	assert.equal(await realpath(join(outputDir, "current")), firstImage);

	for (const [sourceLink, expectedError] of [
		[join(codingAgentDir, "dist", "escaped-runtime.txt"), /Pi runtime tree contains a symbolic link/],
		[join(codingAgentDir, "docs", "escaped-doc.txt"), /Pi documentation tree contains a symbolic link/],
	]) {
		await symlink(outsideWorkflowFile, sourceLink);
		await assert.rejects(buildByzPackage(options), expectedError);
		await rm(sourceLink);
		assert.equal(await realpath(join(outputDir, "current")), firstImage);
	}
	const changelogPath = join(packageDir, "CHANGELOG.md");
	await rm(changelogPath);
	await symlink(outsideWorkflowFile, changelogPath);
	await assert.rejects(buildByzPackage(options), /BYZ package metadata CHANGELOG.md contains a symbolic link/);
	await rm(changelogPath);
	await writeFixture(changelogPath, "# Changelog\n");
	assert.equal(await realpath(join(outputDir, "current")), firstImage);

	const generationsBeforeSourceLink = (await readdir(join(outputDir, "generations"))).sort();
	const outsideSourceFile = join(root, "outside-source.js");
	const escapedSourceLink = join(packageDir, "src", "leak.js");
	await writeFixture(outsideSourceFile, 'export const leaked = "outside";\n');
	await symlink(outsideSourceFile, escapedSourceLink);
	await assert.rejects(buildByzPackage(options), /BYZ source tree contains a symbolic link/);
	await rm(escapedSourceLink);
	assert.deepEqual((await readdir(join(outputDir, "generations"))).sort(), generationsBeforeSourceLink);
	assert.equal(await realpath(join(outputDir, "current")), firstImage);

	await writeFixture(join(packageDir, "src", "runtime", "bundle", "index.ts"), "export const collision = true;\n");
	await assert.rejects(buildByzPackage(options), /overlaps the reserved Pi runtime tree/);
	await rm(join(packageDir, "src", "runtime"), { force: true, recursive: true });
	assert.equal(await realpath(join(outputDir, "current")), firstImage);

	for (const [sourcePath, expectedError] of [
		["core/export-html/Template.ts", /portable path conflicts with reserved Pi runtime asset/],
		["ｃore/export-html/template.ts", /Compiled BYZ output path is not portable/],
		["core./export-html/template.ts", /Compiled BYZ output path is not portable/],
	]) {
		await writeFixture(join(packageDir, "src", sourcePath), "export const portableCollision = true;\n");
		await assert.rejects(buildByzPackage(options), expectedError);
		await rm(join(packageDir, "src", sourcePath.split("/")[0]), { force: true, recursive: true });
		assert.equal(await realpath(join(outputDir, "current")), firstImage);
	}

	const heldLock = await acquireBuildLock(outputDir, { packageDir });
	await assert.rejects(buildByzPackage(options), /Another BYZ build is active/);
	assert.equal(await heldLock(), true);
	assert.equal(await realpath(join(outputDir, "current")), firstImage);

	const staleIdentity = { pid: 201, processStartId: "stale-build" };
	const nextIdentity = { pid: 202, processStartId: "next-build" };
	const staleLock = await acquireBuildLock(outputDir, {
		packageDir,
		processIdentityProbe: {
			async current() {
				return staleIdentity;
			},
			async inspect(_pid, processStartId) {
				return processStartId === staleIdentity.processStartId ? "same" : "absent";
			},
		},
	});
	const promotionProbe = {
		async current() {
			return nextIdentity;
		},
		async inspect(_pid, processStartId) {
			if (processStartId === nextIdentity.processStartId) return "same";
			if (processStartId !== staleIdentity.processStartId) return "absent";
			return (await realpath(join(outputDir, "current"))) === firstImage ? "absent" : "unknown";
		},
	};
	await assert.rejects(buildByzPackage({ ...options, processIdentityProbe: promotionProbe }), (error) => {
		assert.equal(error.name, "PackagePublicationError");
		assert.equal(error.publicationState, "promoted-unconfirmed");
		return true;
	});
	const promotedImage = await realpath(join(outputDir, "current"));
	assert.notEqual(promotedImage, firstImage);
	assert.match(await readFile(join(promotedImage, "dist", "nested", "probe.js"), "utf8"), /probe = "included"/);
	assert.equal(await staleLock(), true);

	await writeFixture(join(packageDir, "src", "broken.ts"), "export const broken = ;\n");
	await assert.rejects(buildByzPackage(options));
	assert.equal(await realpath(join(outputDir, "current")), promotedImage);
	await rm(join(packageDir, "src", "broken.ts"));
	const recovered = await buildByzPackage(options);
	assert.notEqual(await realpath(recovered.imageDir), promotedImage);
	assert.equal(await realpath(join(outputDir, "current")), await realpath(recovered.imageDir));

	const generationsBeforeMalformedCurrent = await readdir(join(outputDir, "generations"));
	await rm(join(outputDir, "current"));
	await symlink(".build-locks-v3", join(outputDir, "current"), "dir");
	await writeFixture(join(packageDir, "src", "broken.ts"), "export const broken = ;\n");
	await assert.rejects(buildByzPackage(options));
	assert.equal((await readdir(join(outputDir, "generations"))).length, generationsBeforeMalformedCurrent.length + 1);
	await assert.rejects(resolveCurrentPackageImage(outputDir), /does not reference a valid generation package/);
	await rm(join(packageDir, "src", "broken.ts"));
	await rm(join(outputDir, "current"));
	await symlink(
		relative(await realpath(outputDir), await realpath(recovered.imageDir)),
		join(outputDir, "current"),
		"dir",
	);
	assert.equal(await realpath(join(outputDir, "current")), await realpath(recovered.imageDir));
});

test("rejects unsafe manifests and escaped current pointers", async (t) => {
	const valid = {
		schemaVersion: 1,
		sourceRoot: "src",
		generatedRoots: ["dist", "docs", "examples", "workflows"],
		runtimeAssets: ["theme.json"],
		packageMetadata: ["package.json"],
	};
	assert.doesNotThrow(() => validateBuildManifest(valid));
	assert.throws(
		() => validateBuildManifest({ ...valid, runtimeAssets: ["../outside"] }),
		/Invalid BYZ build manifest/,
	);
	assert.throws(
		() => validateBuildManifest({ ...valid, runtimeAssets: ["Theme.js", "theme.js"] }),
		/Invalid BYZ build manifest/,
	);
	assert.throws(
		() => validateBuildManifest({ ...valid, runtimeAssets: ["A.js", "a.js-foo.js", "a.js/b.js"] }),
		/Invalid BYZ build manifest/,
	);
	assert.throws(
		() => validateBuildManifest({ ...valid, runtimeAssets: ["runtime/bundle/index.js"] }),
		/Invalid BYZ build manifest/,
	);
	for (const metadataPath of ["dist/cli.js", "Dist/CLI.js"]) {
		assert.throws(
			() => validateBuildManifest({ ...valid, packageMetadata: ["package.json", metadataPath] }),
			/Invalid BYZ build manifest/,
		);
	}
	assert.doesNotThrow(() => validateWorkflowBundlePath("workflows/cm"));
	assert.throws(() => validateWorkflowBundlePath("../../src"), /Unsafe workflow bundle path/);
	assert.throws(
		() =>
			createPublishedPackageJson({
				bin: { byz: ".byz-output/current/README.md" },
				exports: { ".": "./.byz-output/current/README.md" },
				main: "./.byz-output/current/README.md",
				types: "./.byz-output/current/README.md",
			}),
		/published dist tree/,
	);
	const root = await mkdtemp(join(tmpdir(), "byz-build-escape-"));
	t.after(() => rm(root, { force: true, recursive: true }));
	const outputDir = join(root, "output");
	const outside = join(root, "outside");
	await Promise.all([mkdir(outputDir), mkdir(outside)]);
	await symlink(outside, join(outputDir, "current"), "dir");
	await assert.rejects(resolveCurrentPackageImage(outputDir), /escaped output root/);
});

test("validates generated roots, package metadata, and runtime assets", async (t) => {
	const imageDir = await mkdtemp(join(tmpdir(), "byz-build-image-"));
	t.after(() => rm(imageDir, { force: true, recursive: true }));
	await Promise.all([
		mkdir(join(imageDir, "dist", "runtime"), { recursive: true }),
		mkdir(join(imageDir, "docs")),
		writeFixture(join(imageDir, "package.json"), "{}"),
		writeFixture(join(imageDir, "dist", "theme.json"), "{}"),
	]);
	await validatePackageImage({
		imageDir,
		manifest: { generatedRoots: ["dist", "docs"], packageMetadata: ["package.json"], runtimeAssets: ["theme.json"] },
	});
	await writeFixture(join(imageDir, "outside.txt"), "outside\n");
	await symlink(join(imageDir, "outside.txt"), join(imageDir, "docs", "escaped.txt"));
	await assert.rejects(
		validatePackageImage({
			imageDir,
			manifest: {
				generatedRoots: ["dist", "docs"],
				packageMetadata: ["package.json"],
				runtimeAssets: ["theme.json"],
			},
		}),
		/Package image contains a symbolic link/,
	);
	await rm(join(imageDir, "docs", "escaped.txt"));
	await assert.rejects(
		validatePackageImage({
			imageDir,
			manifest: {
				generatedRoots: ["dist", "docs"],
				packageMetadata: ["package.json"],
				runtimeAssets: ["missing.json"],
			},
		}),
		/Package image is missing runtime asset: missing.json/,
	);
});
