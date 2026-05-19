// Artifact and session-activity I/O helpers.
// input:  thread-store, session-activity JSONL, diff library
// output: readArtifact / cleanupWorkspace / getModifiedFilesFromSession / getSessionFileChanges / renderModifiedFilesWithDiff

import { readFileSync, rmSync, existsSync } from 'fs';
import * as path from 'path';
import * as Diff from 'diff';
import { DATA_DIR } from '@core/utils.js';
import { createLogger } from '@core/log.js';
import { threadStore } from '@store/thread-repo.js';

const log = createLogger('artifact-io');

// --- Session-activity JSONL types ---

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

interface MutationRecord {
  ts: string;
  event: 'edit_file' | 'write_file';
  tool: 'Edit' | 'Write';
  file_path: string;
  device?: string;
  originalFile?: string | null;
  structuredPatch?: DiffHunk[];
  writtenContent?: string;
  diffDegraded?: boolean;
}

export interface FileChange {
  file_path: string;
  device?: string;
  mode: 'net' | 'degraded' | 'no-diff';
  unifiedDiff: string;
}

// --- Internal helpers ---

function sessionLogPath(sessionId: string): string {
  return path.join(DATA_DIR, 'logs', 'session-activity', `${sessionId}.jsonl`);
}

function readMutationRecords(sessionId: string | null | undefined): MutationRecord[] {
  if (!sessionId) return [];
  const logPath = sessionLogPath(sessionId);
  if (!existsSync(logPath)) return [];
  let content: string;
  try { content = readFileSync(logPath, 'utf8'); } catch { return []; }
  if (!content.trim()) return [];
  const out: MutationRecord[] = [];
  for (const line of content.split('\n')) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      if ((r.event === 'edit_file' || r.event === 'write_file')
          && typeof r.file_path === 'string' && r.file_path.trim()) {
        out.push(r as MutationRecord);
      }
    } catch { continue; }
  }
  return out;
}

function applyHunksOrFuzz(state: string, hunks: DiffHunk[], filePath: string): string | null {
  const patch: Diff.ParsedDiff = {
    oldFileName: filePath, newFileName: filePath,
    oldHeader: '', newHeader: '',
    hunks: hunks as unknown as Diff.ParsedDiff['hunks'],
  };
  for (const fuzz of [0, 2]) {
    const next = Diff.applyPatch(state, patch, { fuzzFactor: fuzz });
    if (typeof next === 'string') return next;
  }
  return null;
}

function formatDegradedDiff(filePath: string, hunks: DiffHunk[]): string {
  if (hunks.length === 0) return `(no hunks captured for ${filePath})`;
  const header = `--- a/${filePath}\n+++ b/${filePath}\n[diff unavailable: external concurrent modification broke patch context; showing raw hunks]`;
  const body = hunks.map(h => {
    const head = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
    return [head, ...h.lines].join('\n');
  }).join('\n');
  return `${header}\n${body}`;
}

// --- Public API ---

/** Read modified file paths from session-activity JSONL for a given session ID.
 *  Collects both edit_file and write_file events, deduplicates, returns unique paths. */
export function getModifiedFilesFromSession(sessionId: string | null | undefined): string[] {
  const records = readMutationRecords(sessionId);
  if (records.length === 0) return [];
  const files = new Set<string>();
  for (const r of records) files.add(r.file_path.trim());
  return Array.from(files);
}

/** Compute net unified diffs for every (device, file_path) touched in a session.
 *  Returns one entry per file, ordered by first-touch time. */
export function getSessionFileChanges(sessionId: string | null | undefined): FileChange[] {
  const records = readMutationRecords(sessionId);
  if (records.length === 0) return [];

  const groups = new Map<string, MutationRecord[]>();
  const order: string[] = [];
  for (const r of records) {
    const key = `${r.device || ''}::${r.file_path}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(r);
  }

  const out: FileChange[] = [];
  for (const key of order) {
    const group = groups.get(key)!.sort((a, b) => a.ts.localeCompare(b.ts));
    const first = group[0];
    const filePath = first.file_path;

    if (group.some(r => r.diffDegraded)) {
      out.push({ file_path: filePath, device: first.device, mode: 'no-diff', unifiedDiff: '' });
      continue;
    }
    if (group.some(r => r.originalFile === undefined && r.writtenContent === undefined)) {
      out.push({ file_path: filePath, device: first.device, mode: 'no-diff', unifiedDiff: '' });
      continue;
    }

    const baseline = (first.originalFile ?? '') as string;
    let state = baseline;
    let degraded = false;
    for (const r of group) {
      if (r.tool === 'Write') {
        state = typeof r.writtenContent === 'string' ? r.writtenContent : '';
      } else {
        const hunks = r.structuredPatch || [];
        if (hunks.length === 0) continue;
        const next = applyHunksOrFuzz(state, hunks, filePath);
        if (next === null) { degraded = true; break; }
        state = next;
      }
    }

    if (degraded) {
      const allHunks = group.flatMap(r => r.structuredPatch || []);
      out.push({ file_path: filePath, device: first.device, mode: 'degraded', unifiedDiff: formatDegradedDiff(filePath, allHunks) });
    } else {
      const unifiedDiff = baseline === state
        ? ''
        : Diff.createPatch(filePath, baseline, state, '', '');
      out.push({ file_path: filePath, device: first.device, mode: 'net', unifiedDiff });
    }
  }
  return out;
}

/** Render FileChange[] as markdown with fenced ```diff blocks per file. Empty when changes is empty. */
export function renderModifiedFilesWithDiff(changes: FileChange[]): string {
  if (changes.length === 0) return '';
  return changes.map(c => {
    const deviceTag = c.device ? ` (device: ${c.device})` : '';
    const modeTag = c.mode === 'degraded'
      ? ' [diff unavailable: external concurrent modification]'
      : c.mode === 'no-diff'
        ? ' [diff unavailable: snapshot missing]'
        : '';
    const body = c.unifiedDiff ? `\`\`\`diff\n${c.unifiedDiff}\n\`\`\`` : '_(no textual change)_';
    return `### ${c.file_path}${deviceTag}${modeTag}\n${body}`;
  }).join('\n\n');
}

/** Read the artifact file content for a thread */
export function readArtifact(threadId: string): string | null {
  const thread = threadStore.get(threadId);
  if (!thread?.artifactPath) return null;
  try {
    return readFileSync(thread.artifactPath, 'utf8');
  } catch {
    return null;
  }
}

/** Remove the workspace directory for a thread */
export function cleanupWorkspace(threadId: string): void {
  const thread = threadStore.get(threadId);
  if (!thread?.workspacePath) return;
  try {
    rmSync(thread.workspacePath, { recursive: true, force: true });
    log.info(`Cleaned up workspace for ${threadId}`);
  } catch (e: any) {
    log.error(`Failed to cleanup workspace for ${threadId}: ${e.message}`);
  }
}
