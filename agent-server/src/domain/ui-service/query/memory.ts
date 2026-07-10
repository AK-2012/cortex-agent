// input:  UiServiceDeps + MemoryTreeParams / MemoryFileParams
// output: handleMemoryTree → MemoryTree; handleMemoryFile → MemoryFile
// pos:    read-only fs query handlers for 'memory.tree' and 'memory.file'. All paths are
//         restricted to the project root (Project.contextDir under PROJECTS_DIR); traversal,
//         absolute paths, and symlink escape are rejected. No write API is used.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type {
  UiServiceDeps,
  MemoryTreeParams,
  MemoryFileParams,
  MemoryTree,
  MemoryFile,
  MemoryLineDiff,
} from '../types.js';

// Canonical top-level memory files, in display order. Missing ones are omitted (not errored).
const TOP_LEVEL_FILES = ['mission.md', 'roadmap.md', 'STATUS.md', 'TASKS.yaml'];
// Memory subdirectories whose `*.md` entries are counted (excluding the auto-generated index.md).
const MEMORY_DIRS = ['experiments', 'knowledge', 'patterns', 'decisions'];

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: 'not-found' });
}
function invalidArgs(message: string): Error {
  return Object.assign(new Error(message), { code: 'invalid-args' });
}

// Resolve the project's real (symlink-canonical) root directory, or throw not-found.
function resolveProjectRoot(deps: UiServiceDeps, projectId: string): string {
  const project = deps.projectStore.get(projectId);
  if (!project) throw notFound(`project not found: ${projectId}`);
  try {
    return fs.realpathSync(project.contextDir);
  } catch {
    throw notFound(`project directory not found: ${projectId}`);
  }
}

// True when `child` is `root` itself or strictly nested under it.
function isWithin(root: string, child: string): boolean {
  return child === root || child.startsWith(root + path.sep);
}

// Resolve a project-root-relative file path to an absolute path, rejecting absolute inputs,
// `..` traversal, non-files, and symlink escape (via realpath re-check). Read-only.
function resolveMemoryFilePath(realRoot: string, relPath: string): string {
  if (path.isAbsolute(relPath)) throw invalidArgs(`absolute path not allowed: ${relPath}`);

  const resolved = path.resolve(realRoot, relPath);
  if (!isWithin(realRoot, resolved)) throw invalidArgs(`path escapes project root: ${relPath}`);

  let real: string;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    throw notFound(`file not found: ${relPath}`);
  }
  // Symlink escape: the real (canonical) path must still live under the real root.
  if (!isWithin(realRoot, real)) throw invalidArgs(`path escapes project root: ${relPath}`);
  if (!fs.statSync(real).isFile()) throw invalidArgs(`not a file: ${relPath}`);
  return real;
}

export async function handleMemoryTree(
  deps: UiServiceDeps,
  params: MemoryTreeParams,
): Promise<MemoryTree> {
  const root = resolveProjectRoot(deps, params.projectId);

  const files = TOP_LEVEL_FILES.flatMap((name) => {
    const abs = path.join(root, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      return [];
    }
    if (!st.isFile()) return [];
    return [{ name, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() }];
  });

  const dirs = MEMORY_DIRS.flatMap((name) => {
    const abs = path.join(root, name);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return [];
    }
    const entryCount = entries.filter(
      (e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'index.md' && e.name !== 'CORTEX.md',
    ).length;
    return [{ name, entryCount }];
  });

  return { projectId: params.projectId, files, dirs };
}

// Real working-tree-vs-HEAD line counts via `git diff --numstat`. Returns null (honest placeholder,
// never fabricated) when the project dir is not a git work tree, git is unavailable, or the diff is
// binary/unresolvable. Read-only; array args (no shell) — `relPath` is the already-validated
// project-relative path, so there is no injection surface.
function gitLineDiff(root: string, relPath: string): MemoryLineDiff | null {
  let out: string;
  try {
    out = execFileSync('git', ['diff', '--numstat', 'HEAD', '--', relPath], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch {
    // git missing / not a repo / non-zero exit → unknown, not fabricated.
    return null;
  }
  const line = out.split('\n').find((l) => l.trim().length > 0);
  // No diff vs HEAD (e.g. a clean auto-committed file) → the real answer is 0/0.
  if (!line) return { added: 0, removed: 0 };
  const [addedRaw, removedRaw] = line.split('\t');
  // Binary files report `-\t-\t<path>` → counts are unknowable, honest null.
  const added = Number(addedRaw);
  const removed = Number(removedRaw);
  if (!Number.isFinite(added) || !Number.isFinite(removed)) return null;
  return { added, removed };
}

export async function handleMemoryFile(
  deps: UiServiceDeps,
  params: MemoryFileParams,
): Promise<MemoryFile> {
  const root = resolveProjectRoot(deps, params.projectId);
  const abs = resolveMemoryFilePath(root, params.path);

  const st = fs.statSync(abs);
  const content = fs.readFileSync(abs, 'utf8');
  return {
    projectId: params.projectId,
    path: params.path,
    content,
    sizeBytes: st.size,
    modifiedAt: st.mtime.toISOString(),
    lineDiff: gitLineDiff(root, params.path),
  };
}
