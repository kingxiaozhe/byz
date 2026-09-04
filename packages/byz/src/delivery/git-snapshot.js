import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 256 * 1024;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

export function parsePorcelainZ(value) {
	if (typeof value !== "string" || value.length > MAX_OUTPUT) throw new Error("Git status output is unavailable.");
	const fields = value.split("\0");
	if (fields.at(-1) === "") fields.pop();
	const records = [];
	for (let index = 0; index < fields.length; index += 1) {
		const field = fields[index];
		if (field.length < 4 || field[2] !== " ") throw new Error("Git status output is invalid.");
		const indexState = field[0];
		const worktreeState = field[1];
		const path = field.slice(3);
		if (!path || path.startsWith("/") || path.includes("\n") || path.includes("\r") || path.includes("\0")) {
			throw new Error("Git status path is invalid.");
		}
		const renamed = indexState === "R" || indexState === "C" || worktreeState === "R" || worktreeState === "C";
		const sourcePath = renamed ? fields[++index] : undefined;
		if (renamed && !sourcePath) throw new Error("Git rename status is incomplete.");
		records.push(
			Object.freeze({
				conflict:
					indexState === "U" || worktreeState === "U" || ["AA", "DD"].includes(`${indexState}${worktreeState}`),
				indexState,
				path,
				renamed,
				sourcePath,
				untracked: indexState === "?" && worktreeState === "?",
				worktreeState,
			}),
		);
	}
	return Object.freeze(records);
}

export function sanitizeOrigin(value) {
	if (typeof value !== "string" || value.length > 2048) return undefined;
	try {
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			url.hostname.toLowerCase() !== "github.com" ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) {
			return undefined;
		}
		const slug = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
		return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug)
			? Object.freeze({ host: "github", repository: slug })
			: undefined;
	} catch {
		const match = /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value);
		return match ? Object.freeze({ host: "github", repository: match[1] }) : undefined;
	}
}

export function createDeliveryProcessRunner(options = {}) {
	return Object.freeze({
		async run(program, args, runOptions = {}) {
			if (!["git", "gh"].includes(program) || !Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
				throw new Error("Delivery runner rejected the process request.");
			}
			try {
				const { stdout, stderr } = await (options.execFileAsync ?? execFileAsync)(program, args, {
					cwd: runOptions.cwd,
					encoding: "utf8",
					maxBuffer: MAX_OUTPUT,
					timeout: runOptions.timeoutMs ?? 10_000,
				});
				return Object.freeze({ exitCode: 0, stderr, stdout, timedOut: false });
			} catch (error) {
				return Object.freeze({
					exitCode: Number.isSafeInteger(error?.code) ? error.code : 1,
					stderr: typeof error?.stderr === "string" ? error.stderr.slice(0, MAX_OUTPUT) : "",
					stdout: typeof error?.stdout === "string" ? error.stdout.slice(0, MAX_OUTPUT) : "",
					timedOut: error?.killed === true,
				});
			}
		},
	});
}

function requireSuccess(result, label, trim = true) {
	if (result.exitCode !== 0 || result.timedOut) throw new Error(`${label} is unavailable.`);
	return trim ? result.stdout.trim() : result.stdout;
}

export async function createGitSnapshot(options) {
	const run = (args) => options.runner.run("git", args, { cwd: options.cwd, timeoutMs: 10_000 });
	const root = requireSuccess(await run(["rev-parse", "--show-toplevel"]), "Git root");
	if ((await realpath(root)) !== (await realpath(options.cwd))) {
		throw new Error("Git root does not match the trusted workspace.");
	}
	const head = requireSuccess(await run(["rev-parse", "HEAD"]), "Git HEAD");
	if (!/^[0-9a-f]{40}$/.test(head)) throw new Error("Git HEAD is invalid.");
	const branchResult = await run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
	const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : undefined;
	if (branch && !SAFE_REF.test(branch)) throw new Error("Git branch is invalid.");
	const status = parsePorcelainZ(
		requireSuccess(await run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]), "Git status", false),
	);
	const upstreamResult = await run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
	const upstream = upstreamResult.exitCode === 0 ? upstreamResult.stdout.trim() : undefined;
	const originResult = await run(["remote", "get-url", "origin"]);
	const origin = originResult.exitCode === 0 ? sanitizeOrigin(originResult.stdout.trim()) : undefined;
	const remoteOidResult = branch ? await run(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]) : undefined;
	const remoteBranchOid = remoteOidResult?.exitCode === 0 ? remoteOidResult.stdout.trim().split(/\s+/)[0] : undefined;
	const scope = await options.scopeTracker.candidates();
	const statusByPath = new Map(status.map((entry) => [entry.path, entry]));
	const candidatePaths = scope.flatMap((entry) => {
		const current = statusByPath.get(entry.path);
		return entry.current &&
			current &&
			current.indexState === " " &&
			current.worktreeState !== " " &&
			!current.conflict
			? [entry.path]
			: [];
	});
	const candidateSet = new Set(candidatePaths);
	const candidateDigests = scope
		.filter((entry) => candidateSet.has(entry.path))
		.map((entry) => [entry.path, entry.digest])
		.sort();
	const excluded = status.filter((entry) => !candidateSet.has(entry.path));
	const fingerprintInput = JSON.stringify({
		branch,
		candidateDigests,
		candidatePaths: [...candidatePaths].sort(),
		excluded: excluded.map((entry) => [entry.path, entry.indexState, entry.worktreeState]),
		generation: options.registrySnapshot?.generation,
		head,
		origin,
		pr: options.pr
			? {
					number: options.pr.number,
					headSha: options.pr.headSha,
					baseSha: options.pr.baseSha,
					base: options.pr.base,
					checks: options.pr.checks,
					mergeable: options.pr.mergeable,
					repository: options.pr.repository,
					requiredChecks: options.pr.requiredChecks,
				}
			: undefined,
		remoteBranchOid,
		status: status.map((entry) => [entry.path, entry.indexState, entry.worktreeState, entry.sourcePath]),
		upstream,
	});
	return Object.freeze({
		branch,
		candidateDigests: Object.freeze(candidateDigests.map((entry) => Object.freeze(entry))),
		candidatePaths: Object.freeze([...candidatePaths].sort()),
		conflictCount: status.filter((entry) => entry.conflict).length,
		detached: !branch,
		excludedCount: excluded.length,
		fingerprint: createHash("sha256").update(fingerprintInput).digest("hex"),
		head,
		origin,
		remoteBranchOid: /^[0-9a-f]{40}$/.test(remoteBranchOid ?? "") ? remoteBranchOid : undefined,
		status,
		upstream,
	});
}
