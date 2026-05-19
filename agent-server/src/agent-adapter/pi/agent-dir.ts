// input:  DATA_DIR
// output: PI_AGENT_DIR / PI_SESSIONS_DIR / PI_MODELS_PATH constants + writeAnthropicBaseUrl + ensurePIAgentDirs
// pos:    PI agent directory management; models.json is written exclusively by PI adapter spawn
// layout: data/pi/models.json  logs/sessions-pi/
//         PI_CODING_AGENT_DIR → DATA_DIR/data/pi (PI reads models.json from here)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { mkdirSync, writeFileSync, renameSync } from 'fs';
import * as path from 'path';
import { DATA_DIR } from '@core/utils.js';

/** PI_CODING_AGENT_DIR: PI reads models.json, auth.json from this dir. */
export const PI_AGENT_DIR = path.join(DATA_DIR, 'data', 'pi');
export const PI_SESSIONS_DIR = path.join(DATA_DIR, 'logs', 'sessions-pi');
export const PI_MODELS_PATH = path.join(PI_AGENT_DIR, 'models.json');

/**
 * Atomic-write models.json with anthropic provider config.
 * Called by PIAdapter.spawn() — sole writer, no other code path touches this file.
 * Uses a placeholder apiKey ("x") because the gateway replaces it with the real key.
 */
export function writeAnthropicBaseUrl(baseUrl: string): void {
  const data = {
    providers: {
      anthropic: { baseUrl, apiKey: 'x' },
    },
  };
  const content = JSON.stringify(data, null, 2) + '\n';

  // Atomic write: tmp + rename
  const tmp = `${PI_MODELS_PATH}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, PI_MODELS_PATH);
}

export function ensurePIAgentDirs(): void {
  mkdirSync(PI_AGENT_DIR, { recursive: true });
  mkdirSync(PI_SESSIONS_DIR, { recursive: true });
}
