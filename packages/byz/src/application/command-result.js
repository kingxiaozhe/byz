const COMMAND_STATUSES = new Set(["handled", "passthrough"]);

function copyLines(lines, field) {
	if (!Array.isArray(lines) || lines.some((line) => typeof line !== "string")) {
		throw new Error(`Invalid CommandResult ${field}.`);
	}
	return [...lines];
}

export function createHandledResult(options = {}) {
	const exitCode = options.exitCode ?? 0;
	if (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255) {
		throw new Error("Invalid CommandResult exitCode.");
	}
	return {
		status: "handled",
		exitCode,
		stdout: copyLines(options.stdout ?? [], "stdout"),
		stderr: copyLines(options.stderr ?? [], "stderr"),
	};
}

export function createPassthroughResult() {
	return { status: "passthrough", exitCode: 0, stdout: [], stderr: [] };
}

export function validateCommandResult(result) {
	if (!result || typeof result !== "object" || !COMMAND_STATUSES.has(result.status)) {
		throw new Error("Command returned an invalid CommandResult status.");
	}
	if (result.status === "passthrough") {
		if (result.exitCode !== 0 || result.stdout?.length !== 0 || result.stderr?.length !== 0) {
			throw new Error("Passthrough CommandResult cannot contain output or a non-zero exit code.");
		}
		return createPassthroughResult();
	}
	return createHandledResult(result);
}

export function createCommandOutput() {
	const stdout = [];
	const stderr = [];
	return {
		exitCode: 0,
		stderr,
		stdout,
		writeStderr(line) {
			stderr.push(line);
		},
		writeStdout(line) {
			stdout.push(line);
		},
	};
}

export function resultFromOutput(output) {
	return createHandledResult({ exitCode: output.exitCode, stdout: output.stdout, stderr: output.stderr });
}
