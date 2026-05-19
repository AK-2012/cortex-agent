// input:  Claude session UUID, turn index, REPO_ROOT
// output: path + create/restore/cleanup backup helpers
// pos:    Claude session JSONL per-turn backup and restore
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<
import { copyFileSync, existsSync, unlinkSync, readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DATA_DIR } from '@core/utils.js';
import { createLogger } from '@core/log.js';

const log = createLogger('session-backup');

/**
 * Derive the Claude Code project directory hash from DATA_DIR.
 * Claude Code encodes project directories by replacing '/' and '.' with '-'.
 * e.g. /home/user/.cortex → -home-user--cortex
 */
function getProjectHash(): string {
  return DATA_DIR.replace(/[\/.]/g, '-');
}

function getProjectDir(): string {
  return path.join(os.homedir(), '.claude', 'projects', getProjectHash());
}

/**
 * Get the path to a Claude Code session JSONL file.
 */
function getSessionFilePath(sessionId: string): string {
  return path.join(getProjectDir(), `${sessionId}.jsonl`);
}

function getBackupPath(sessionId: string, turnIndex: number): string {
  return path.join(getProjectDir(), `${sessionId}.jsonl.turn-${turnIndex}.bak`);
}

// --- PI session file utilities ---

/** PI session directory (matches agent-adapter/pi/agent-dir.ts). */
const PI_SESSIONS_DIR = path.join(DATA_DIR, 'logs', 'sessions-pi');

/**
 * Find a PI session file by session ID.
 * Scans the PI session directory for .jsonl files and matches by the header's `id` field.
 * Returns the full file path, or null if not found.
 */
function findPISessionFile(sessionId: string): string | null {
  if (!existsSync(PI_SESSIONS_DIR)) return null;
  let files: string[];
  try {
    files = readdirSync(PI_SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
  } catch {
    return null;
  }
  for (const f of files) {
    const filePath = path.join(PI_SESSIONS_DIR, f);
    try {
      const content = readFileSync(filePath, 'utf8');
      const newlineIdx = content.indexOf('\n');
      const firstLine = newlineIdx === -1 ? content : content.slice(0, newlineIdx);
      const header = JSON.parse(firstLine);
      if (header && header.type === 'session' && header.id === sessionId) {
        return filePath;
      }
    } catch {
      // Skip unreadable/unparseable files
    }
  }
  return null;
}

/**
 * Create a session file backup at an explicit file path.
 * The backup is stored as `<filePath>.turn-<turnIndex>.bak`.
 * Returns the backup path, or null if the file doesn't exist.
 */
function backupSessionFile(filePath: string, turnIndex: number): string | null {
  if (!existsSync(filePath)) return null;
  const backup = `${filePath}.turn-${turnIndex}.bak`;
  try {
    copyFileSync(filePath, backup);
    log.info(`Created backup: turn-${turnIndex} for ${path.basename(filePath)}`);
    return backup;
  } catch (e) {
    log.error(`Failed to create backup:`, (e as Error).message);
    return null;
  }
}

/**
 * Restore a session file from a turn backup.
 * Returns true if the backup was found and restored.
 */
function restoreSessionFile(filePath: string, turnIndex: number): boolean {
  const backup = `${filePath}.turn-${turnIndex}.bak`;
  if (!existsSync(backup)) {
    log.warn(`Backup not found: turn-${turnIndex} for ${path.basename(filePath)}`);
    return false;
  }
  try {
    copyFileSync(backup, filePath);
    log.info(`Restored from backup: turn-${turnIndex} for ${path.basename(filePath)}`);
    return true;
  } catch (e) {
    log.error(`Failed to restore backup:`, (e as Error).message);
    return false;
  }
}

/**
 * Delete backups for turns strictly after the given index for a specific session file.
 * Backups are named `<basename>.turn-<N>.bak`.
 */
function cleanupBackupsForFile(filePath: string, afterTurnIndex: number): void {
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath);
  const prefix = `${basename}.turn-`;
  const suffix = '.bak';
  try {
    const files = readdirSync(dir);
    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue;
      const turnStr = file.slice(prefix.length, -suffix.length);
      const turnIdx = parseInt(turnStr, 10);
      if (!isNaN(turnIdx) && turnIdx > afterTurnIndex) {
        unlinkSync(path.join(dir, file));
      }
    }
  } catch (e) {
    log.error(`cleanupBackupsForFile failed:`, (e as Error).message);
  }
}

/**
 * Create a backup of the session file before processing a turn.
 * Returns the backup path, or null if the session file doesn't exist yet.
 */
function createBackup(sessionId: string, turnIndex: number): string | null {
  const sessionFile = getSessionFilePath(sessionId);
  if (!existsSync(sessionFile)) return null;

  const backup = getBackupPath(sessionId, turnIndex);
  try {
    copyFileSync(sessionFile, backup);
    log.info(`Created backup: turn-${turnIndex} for ${sessionId.substring(0, 8)}`);
    return backup;
  } catch (e) {
    log.error(`Failed to create backup:`, (e as Error).message);
    return null;
  }
}

function restoreBackup(sessionId: string, turnIndex: number): boolean {
  const backup = getBackupPath(sessionId, turnIndex);
  const sessionFile = getSessionFilePath(sessionId);

  if (!existsSync(backup)) {
    log.warn(`Backup not found: turn-${turnIndex} for ${sessionId.substring(0, 8)}`);
    return false;
  }

  try {
    copyFileSync(backup, sessionFile);
    log.info(`Restored from backup: turn-${turnIndex} for ${sessionId.substring(0, 8)}`);
    return true;
  } catch (e) {
    log.error(`Failed to restore backup:`, (e as Error).message);
    return false;
  }
}

/**
 * Delete all backup files for a session.
 * Called on !new to clean up.
 */
function cleanupAllBackups(sessionId: string): void {
  const dir = getProjectDir();
  const prefix = `${sessionId}.jsonl.turn-`;
  const suffix = '.bak';
  try {
    const files = readdirSync(dir);
    let count = 0;
    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith(suffix)) {
        unlinkSync(path.join(dir, file));
        count++;
      }
    }
    if (count > 0) {
      log.info(`Cleaned up ${count} backup(s) for ${sessionId.substring(0, 8)}`);
    }
  } catch (e) {
    log.error(`Cleanup failed:`, (e as Error).message);
  }
}

/**
 * Delete backups for turns strictly after the given index.
 * Called after rollback to remove invalidated backups.
 */
function cleanupBackupsAfter(sessionId: string, afterTurnIndex: number): void {
  const dir = getProjectDir();
  const prefix = `${sessionId}.jsonl.turn-`;
  const suffix = '.bak';
  try {
    const files = readdirSync(dir);
    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue;
      const turnStr = file.slice(prefix.length, -suffix.length);
      const turnIdx = parseInt(turnStr, 10);
      if (!isNaN(turnIdx) && turnIdx > afterTurnIndex) {
        unlinkSync(path.join(dir, file));
      }
    }
  } catch (e) {
    log.error(`cleanupBackupsAfter failed:`, (e as Error).message);
  }
}

export {
  getSessionFilePath,
  createBackup,
  restoreBackup,
  cleanupAllBackups,
  cleanupBackupsAfter,
  getProjectHash,
  // PI session file utilities
  findPISessionFile,
  backupSessionFile,
  restoreSessionFile,
  cleanupBackupsForFile,
};
