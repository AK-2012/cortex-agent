// input:  fs, path, DATA_DIR
// output: cleanupLogs / ensureMcpConfig
// pos:    collection of pure helper functions for the startup phase
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<
import { readdirSync, statSync, unlinkSync } from 'fs';
import * as path from 'path';
import { DATA_DIR } from '@core/utils.js';
import { createLogger } from '@core/log.js';
import { generateMcpConfig } from '@core/config-generator.js';

const log = createLogger('startup');

const LOGS_DIR = path.join(DATA_DIR, 'logs', 'sessions');
const LOG_RETENTION_MS = {
  json: 30 * 24 * 60 * 60 * 1000,
  txt:  30 * 24 * 60 * 60 * 1000,
};

export function cleanupLogs() {
  const now = Date.now();
  let deleted = 0;
  let files;
  try { files = readdirSync(LOGS_DIR); } catch { return; }

  for (const f of files) {
    if (f === 'daemon.log') continue;
    const ext = path.extname(f).toLowerCase();
    const maxAge = (ext === '.json' || ext === '.jsonl') ? LOG_RETENTION_MS.json
                 : ext === '.txt' ? LOG_RETENTION_MS.txt
                 : null;
    if (!maxAge) continue;

    const fp = path.join(LOGS_DIR, f);
    try {
      const { mtimeMs } = statSync(fp);
      if (now - mtimeMs > maxAge) {
        unlinkSync(fp);
        deleted++;
      }
    } catch {}
  }
  if (deleted > 0) log.info(`Log cleanup: deleted ${deleted} old file(s).`);
}

export function ensureMcpConfig(): void {
  try {
    generateMcpConfig();
    log.info('MCP config ensured');
  } catch (error) {
    log.warn(`Failed to ensure MCP config: ${(error as Error).message}`);
  }
}
