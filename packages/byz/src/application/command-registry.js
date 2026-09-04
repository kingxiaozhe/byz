import { createHandledResult, createPassthroughResult, validateCommandResult } from "./command-result.js";

export { createHandledResult, createPassthroughResult } from "./command-result.js";

export function createCommandRegistry(commands) {
	const registeredCommands = [...commands];
	const ids = new Set();
	for (const command of registeredCommands) {
		if (!command || typeof command.id !== "string" || command.id.length === 0) {
			throw new Error("BYZ commands require a non-empty id.");
		}
		if (ids.has(command.id)) throw new Error(`Duplicate BYZ command id: ${command.id}.`);
		if (typeof command.parse !== "function" || typeof command.execute !== "function") {
			throw new Error(`BYZ command ${command.id} requires parse and execute functions.`);
		}
		if (!new Set(["none", "pi", "interactive"]).has(command.runtime)) {
			throw new Error(`BYZ command ${command.id} has an invalid runtime.`);
		}
		ids.add(command.id);
	}

	return Object.freeze({
		async execute(args, context) {
			for (const command of registeredCommands) {
				try {
					const input = command.parse(args);
					if (input === undefined) continue;
					return validateCommandResult(await command.execute(input, context));
				} catch (error) {
					return createHandledResult({
						exitCode: 1,
						stderr: [error instanceof Error ? error.message : String(error)],
					});
				}
			}
			return createPassthroughResult();
		},
	});
}

export function applyCommandResult(result, output) {
	const validated = validateCommandResult(result);
	if (validated.status === "passthrough") return;
	for (const line of validated.stdout) output.stdout(line);
	for (const line of validated.stderr) output.stderr(line);
	output.setExitCode(validated.exitCode);
}
