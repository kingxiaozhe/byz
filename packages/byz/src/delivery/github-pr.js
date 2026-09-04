export async function checkGitHubCli({ cwd, runner }) {
	const result = await runner.run("gh", ["auth", "status", "--hostname", "github.com"], {
		cwd,
		timeoutMs: 10_000,
	});
	return result.exitCode === 0 && !result.timedOut;
}

function success(result) {
	return result?.exitCode === 0 && result.timedOut !== true;
}

export async function readGitHubPr({ cwd, runner }) {
	const repositoryResult = await runner.run("gh", ["repo", "view", "--json", "nameWithOwner"], {
		cwd,
		timeoutMs: 10_000,
	});
	if (!success(repositoryResult)) return undefined;
	let repository;
	try {
		repository = JSON.parse(repositoryResult.stdout).nameWithOwner;
	} catch {
		return undefined;
	}
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) return undefined;

	const result = await runner.run(
		"gh",
		[
			"pr",
			"view",
			"--repo",
			repository,
			"--json",
			"number,headRefOid,baseRefOid,baseRefName,mergeable,statusCheckRollup,state",
		],
		{ cwd, timeoutMs: 10_000 },
	);
	if (!success(result)) return undefined;
	try {
		const value = JSON.parse(result.stdout);
		if (
			!Number.isSafeInteger(value.number) ||
			value.number < 1 ||
			!/^[0-9a-f]{40}$/.test(value.headRefOid ?? "") ||
			!/^[0-9a-f]{40}$/.test(value.baseRefOid ?? "") ||
			typeof value.baseRefName !== "string" ||
			value.state !== "OPEN"
		) {
			return undefined;
		}
		const requiredResult = await runner.run(
			"gh",
			["api", `repos/${repository}/branches/${value.baseRefName}/protection/required_status_checks`],
			{ cwd, timeoutMs: 10_000 },
		);
		if (!success(requiredResult)) return undefined;
		const requiredPayload = JSON.parse(requiredResult.stdout);
		const legacyRequirements = (Array.isArray(requiredPayload.contexts) ? requiredPayload.contexts : []).filter(
			(context) => typeof context === "string",
		);
		const appRequirements = (Array.isArray(requiredPayload.checks) ? requiredPayload.checks : []).filter(
			(check) => typeof check?.context === "string" && (check.app_id === null || Number.isSafeInteger(check.app_id)),
		);
		let checkRuns = [];
		if (appRequirements.length > 0) {
			const checkRunsResult = await runner.run(
				"gh",
				["api", `repos/${repository}/commits/${value.headRefOid}/check-runs`],
				{ cwd, timeoutMs: 10_000 },
			);
			if (!success(checkRunsResult)) return undefined;
			const checkRunsPayload = JSON.parse(checkRunsResult.stdout);
			if (!Array.isArray(checkRunsPayload.check_runs)) return undefined;
			checkRuns = checkRunsPayload.check_runs;
		}
		const rollup = Array.isArray(value.statusCheckRollup) ? value.statusCheckRollup : [];
		const requiredChecks = [
			...legacyRequirements.map((context) => ({
				appId: null,
				context,
				outcome: rollup.some(
					(check) =>
						(check?.context === context || check?.name === context) &&
						["SUCCESS", "success"].includes(check?.conclusion ?? check?.state),
				)
					? "passed"
					: "blocked",
			})),
			...appRequirements.map((requirement) => ({
				appId: requirement.app_id,
				context: requirement.context,
				outcome: checkRuns.some(
					(check) =>
						check?.name === requirement.context &&
						check?.conclusion === "success" &&
						(requirement.app_id === null || check?.app?.id === requirement.app_id),
				)
					? "passed"
					: "blocked",
			})),
		].sort((left, right) =>
			`${left.context}:${left.appId ?? "any"}`.localeCompare(`${right.context}:${right.appId ?? "any"}`),
		);
		const checkState = requiredChecks.every((check) => check.outcome === "passed") ? "success" : "blocked";
		return Object.freeze({
			base: value.baseRefName,
			baseSha: value.baseRefOid,
			checks: checkState,
			headSha: value.headRefOid,
			mergeable: value.mergeable === "MERGEABLE",
			number: value.number,
			repository,
			requiredChecks: Object.freeze(requiredChecks.map((check) => Object.freeze(check))),
		});
	} catch {
		return undefined;
	}
}
