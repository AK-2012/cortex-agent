// input:  REPO_ROOT, fs, thread record
// output: loadUserContext()
// pos:    user profile injection — reads USER.md and injects in direct conversation threads
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { readFileSync, statSync } from 'fs';
import * as path from 'path';
import { CONTEXT_DIR } from '@core/utils.js';

const USER_MD_PATH = path.join(CONTEXT_DIR, 'user', 'USER.md');

const DIRECT_TEMPLATES = new Set(['direct', 'direct-web', 'direct-review']);

let cachedContent: string | null = null;
let cachedMtimeMs = 0;

function readUserMd(): string | null {
  try {
    const stat = statSync(USER_MD_PATH);
    if (stat.mtimeMs === cachedMtimeMs && cachedContent !== null) return cachedContent;
    cachedContent = readFileSync(USER_MD_PATH, 'utf8');
    cachedMtimeMs = stat.mtimeMs;
    return cachedContent;
  } catch {
    return null;
  }
}

interface ThreadLike {
  templateName: string | null;
}

export function loadUserContext(thread: ThreadLike): string | null {
  if (process.env.CORTEX_INJECT_USER_CONTEXT !== '1') return null;

  if (thread.templateName && !DIRECT_TEMPLATES.has(thread.templateName)) return null;

  const content = readUserMd();
  if (!content) return null;

  return `[User Context]\n${content}\n[/User Context]`;
}
