#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyArtifact } from "./artifact.mjs";
import { validateReceiptAgainstCurrentImage } from "./pack.mjs";

const currentFile = fileURLToPath(import.meta.url);
const defaultPackageDir = dirname(dirname(currentFile));

function parseArguments(args) {
	let checkOnly = false;
	let expectedGenerationIdentity;
	let expectedSha256;
	let receiptPath;
	let tarballPath;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--check-only") {
			if (checkOnly) throw new Error("--check-only may be provided only once.");
			checkOnly = true;
		} else if (argument === "--expected-generation") {
			expectedGenerationIdentity = args[++index];
			if (!/^generations\/[^/]+\/package$/.test(expectedGenerationIdentity ?? "")) {
				throw new Error("--expected-generation requires a valid generation identity.");
			}
		} else if (argument === "--expected-sha256") {
			expectedSha256 = args[++index];
			if (!/^[0-9a-f]{64}$/.test(expectedSha256 ?? "")) {
				throw new Error("--expected-sha256 requires a lowercase SHA-256 digest.");
			}
		} else if (argument === "--receipt") {
			receiptPath = args[++index];
			if (!receiptPath || receiptPath.startsWith("--")) throw new Error("--receipt requires a path.");
		} else if (argument === "--tarball") {
			tarballPath = args[++index];
			if (!tarballPath || tarballPath.startsWith("--")) throw new Error("--tarball requires a path.");
		} else {
			throw new Error(`Unknown BYZ artifact verifier argument: ${argument}`);
		}
	}
	if (!receiptPath || !tarballPath) throw new Error("--receipt and --tarball are required.");
	if (!expectedGenerationIdentity || !expectedSha256) {
		throw new Error("--expected-generation and --expected-sha256 are required.");
	}
	return { checkOnly, expectedGenerationIdentity, expectedSha256, receiptPath, tarballPath };
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	const verified = await verifyArtifact(options);
	try {
		await validateReceiptAgainstCurrentImage(defaultPackageDir, verified.receipt);
	} catch (error) {
		await verified.captured.release();
		throw error;
	}
	if (options.checkOnly) {
		await verified.captured.release();
		console.log(JSON.stringify({ generationIdentity: verified.receipt.generationIdentity, sha256: verified.sha256 }));
		return;
	}
	console.log(
		JSON.stringify({
			generationIdentity: verified.receipt.generationIdentity,
			sha256: verified.sha256,
			snapshotDir: dirname(verified.captured.snapshotPath),
			snapshotPath: verified.captured.snapshotPath,
		}),
	);
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
