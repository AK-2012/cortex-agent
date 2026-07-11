// Composer slash-menu dispatch (task 970d). Selecting/running a command from the 18-slash-menu
// is a REAL slash command: the raw '/cmd' message is handed to the agent (which interprets it) by
// sending it through the existing `sessions.send` mutate — no new backend op. This isolates the
// pure decision (what text a menu selection dispatches) so it is unit-testable without React.

export interface SlashDispatch {
  /** The message handed to sessions.send — a real slash command for the agent to interpret. */
  text: string;
}

/** Resolve what running a slash-menu item dispatches. Returns the trimmed '/cmd' to send, or
 *  null for a blank / non-slash input (nothing to dispatch). */
export function slashItemDispatch(cmd: string): SlashDispatch | null {
  const text = cmd.trim();
  if (!text.startsWith('/')) return null;
  return { text };
}
