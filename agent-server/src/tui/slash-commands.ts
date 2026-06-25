// input:  raw input-box text
// output: slash-command registry + pure filter/parse helpers
// pos:    Claude-Code-style `/` command palette data layer for the M5 Ink client.
//         The InputBox renders SLASH_COMMANDS via SlashMenu and dispatches the chosen
//         command id to App.handleCommand. Pure (no Ink) so it is unit-testable.

export interface SlashCommand {
  /** Command id, also the text after the leading `/` (e.g. 'new'). */
  name: string;
  /** One-line description shown in the menu. */
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'new', description: 'New conversation — saves memory, then clears the view' },
  { name: 'newx', description: 'New conversation (fast) — skips the save, clears the view' },
  { name: 'resume', description: 'Resume a session — /resume for the picker, /resume <id> to jump' },
  { name: 'cancel', description: 'Cancel the current turn' },
  { name: 'restart', description: 'Restart the Cortex server (reconnects automatically)' },
  { name: 'help', description: 'Show available slash commands' },
];

export interface ParsedSlash {
  /** True when the text is a slash invocation (starts with '/'). */
  isSlash: boolean;
  /** The command token after '/', lowercased, up to the first space. */
  query: string;
  /** Everything after the first space, trimmed (command arguments). */
  args: string;
}

/** Parse input-box text into its slash parts. Non-slash text yields isSlash:false. */
export function parseSlashInput(text: string): ParsedSlash {
  if (!text.startsWith('/')) return { isSlash: false, query: '', args: '' };
  const rest = text.slice(1);
  const spaceIdx = rest.indexOf(' ');
  if (spaceIdx === -1) {
    return { isSlash: true, query: rest.toLowerCase(), args: '' };
  }
  return {
    isSlash: true,
    query: rest.slice(0, spaceIdx).toLowerCase(),
    args: rest.slice(spaceIdx + 1).trim(),
  };
}

/** Commands whose name starts with `query` (case-insensitive). Empty query → all. */
export function filterSlashCommands(query: string, commands: SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  const q = query.toLowerCase();
  if (q.length === 0) return commands.slice();
  return commands.filter(c => c.name.startsWith(q));
}

/** Exact command match for `query`, or null. */
export function findSlashCommand(query: string, commands: SlashCommand[] = SLASH_COMMANDS): SlashCommand | null {
  const q = query.toLowerCase();
  return commands.find(c => c.name === q) ?? null;
}
