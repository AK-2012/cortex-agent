// input:  backend label ('claude' | 'codex' | 'pi')
// output: getAdapter(backend) + re-exports of adapter surface
// pos:    Unified entry point for the Agent adapter system
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import type { AgentAdapter, Backend } from './types.js';
import { ClaudeAdapter } from './claude/adapter.js';
import { CodexAdapter } from './codex/adapter.js';
import { PIAdapter } from './pi/adapter.js';

export * from './types.js';
export * from './capabilities.js';
export * from './normalize/event-types.js';
export * from './normalize/hooks.js';
export * from './normalize/tool-names.js';

const ADAPTERS: Record<Backend, AgentAdapter> = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
  pi: new PIAdapter(),
};

export function getAdapter(backend: Backend): AgentAdapter {
  const adapter = ADAPTERS[backend];
  if (!adapter) throw new Error(`Unknown backend: ${backend}`);
  return adapter;
}

export async function closeAllAdapters(): Promise<void> {
  for (const adapter of Object.values(ADAPTERS)) {
    for (const key of adapter.listSessions()) {
      try { await adapter.close(key); } catch { /* best-effort */ }
    }
  }
}
