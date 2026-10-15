// input:  assistant text, sessionId, DATA_DIR/tmp
// output: detectMemoryTrigger + enqueueMemoryReminder (sidecar JSONL)
// pos:    Server-side memory trigger detection; hook drains the sidecar
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { appendFileSync, mkdirSync } from 'fs';
import * as path from 'path';
import { createLogger } from '@core/log.js';

// Phrases suggesting a preference or finding worth saving. Matched case-insensitively.
const MEMORY_TRIGGER_PHRASES = [
  'prefer',
  'remember',
  'from now on',
  'always',
  'never',
  'preference',
  'note',
  'future',
  'reference',
] as const;

function memoryReminderPath(sessionId: string, dataDir: string): string {
  return path.join(dataDir, 'tmp', `memory-reminders-${sessionId}.jsonl`);
}

/*
 * Cheap case-insensitive string match against known trigger phrases.
 * Returns the first matched phrase or null when nothing matches.
 */
export function detectMemoryTrigger(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const phrase of MEMORY_TRIGGER_PHRASES) {
    if (lower.includes(phrase)) return phrase;
  }
  return null;
}

/**
 * Append one reminder line to the session sidecar. Best-effort.
 * The PostToolUse hook drains this file into additionalContext on the next tool call.
 */
export function enqueueMemoryReminder(
  sessionId: string,
  matched: string,
  dataDir: string,
): void {
  if (!sessionId) return;
  try {
    const tmpDir = path.join(dataDir, 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    const record = {
      ts: new Date().toISOString(),
      session_id: sessionId,
      matched,
    };
    appendFileSync(memoryReminderPath(sessionId, dataDir), JSON.stringify(record) + '\n', 'utf8');
  } 
  catch (err) {
      const log = createLogger('memory-trigger'); 
      log.error('failed to save reminder:', err);
  }
}
