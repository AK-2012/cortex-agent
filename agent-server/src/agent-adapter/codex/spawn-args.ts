// input:  cwd
// output: buildCodexSystemPrompt pure function
// pos:    Codex CORTEX.md systemPrompt assembly at spawn time
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as path from 'path';
import * as os from 'os';
import { scanCortexMDChain } from '@domain/memory/cortex-md-scanner.js';

/** Scan the CORTEX.md ancestor chain starting from `cwd` and format entries
 *  as a system prompt block. Returns empty string when no CORTEX.md files found.
 *
 *  Called once per CodexAdapterSession at spawn time — the result is cached
 *  for the lifetime of the session. */
export function buildCodexSystemPrompt(cwd: string): string {
  // scanCortexMDChain expects a file path (uses dirname() as scan start).
  // Ensure we scan from cwd by appending a synthetic path component.
  const scanTarget = path.join(cwd, '.__cortex_md_scan__');
  const entries = scanCortexMDChain(scanTarget);
  if (entries.length === 0) return '';

  const hostname = os.hostname();
  const blocks: string[] = [];

  for (const entry of entries) {
    blocks.push(
      '<system-reminder>\n' +
      `Auto-loaded CORTEX.md from ${hostname}:${entry.path} ` +
      `(ancestor of working directory). These instructions apply to files under this directory.\n\n` +
      entry.content +
      '\n</system-reminder>',
    );
  }

  return blocks.join('\n\n');
}
