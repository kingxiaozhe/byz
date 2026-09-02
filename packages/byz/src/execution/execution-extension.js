export function createExecutionExtension({ registry }) {
	if (!registry) throw new Error("Execution extension requires a registry.");

	return (ports) => {
		ports.registerTool((input) => registry.dispatch(input));
		ports.on("session_start", (_event, context) => {
			let entries;
			try {
				entries = context.readEntries();
			} catch {
				entries = undefined;
			}
			registry.replay(entries);
		});
		ports.on("tool_execution_start", (event) => {
			registry.recordToolStart({
				toolCallId: event.toolCallId,
				toolCategory: event.toolCategory,
				commandCategory: event.commandCategory ?? "generic",
			});
		});
		ports.on("tool_execution_end", (event) => {
			registry.recordToolEnd({ toolCallId: event.toolCallId, outcome: event.outcome });
		});
		for (const event of ["agent_end", "session_before_compact", "session_before_switch", "session_shutdown"]) {
			ports.on(event, () => registry.closeInFlight());
		}
	};
}
