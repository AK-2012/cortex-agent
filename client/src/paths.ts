// Client-side path constants.
// Uses ~/.cortex/ as the data root (same as agent-server), but trimmed
// to only the directories the client actually needs.
import * as path from 'path';
import * as os from 'os';

/** User data directory — same as agent-server's DATA_DIR. */
export const DATA_DIR = process.env.CORTEX_HOME
  ? path.resolve(process.env.CORTEX_HOME)
  : path.join(os.homedir(), '.cortex');

/** Configuration files directory (DATA_DIR/config/). */
export const CONFIG_DIR = path.join(DATA_DIR, 'config');

/** Log files directory (DATA_DIR/logs/). */
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
