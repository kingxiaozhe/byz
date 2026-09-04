export async function runUpdateWithDiagnostics(options) {
	const { command, diagnostics, fromVersion, identity, runCommand, toVersion } = options;
	try {
		diagnostics?.captureUpdateBaseline({ fromVersion, toVersion, identity });
	} catch {
		// Diagnostics are best effort and never affect update behavior.
	}
	let commandResult;
	try {
		commandResult = await runCommand(command);
	} catch (error) {
		try {
			diagnostics?.recordUpdateResult({ fromVersion, toVersion, outcome: "command_failed", identity });
		} catch {
			// Preserve the original update rejection.
		}
		throw error;
	}
	try {
		diagnostics?.recordUpdateResult({ fromVersion, toVersion, outcome: "success", identity });
	} catch {
		// Diagnostics are best effort and never affect update behavior.
	}
	return commandResult;
}
