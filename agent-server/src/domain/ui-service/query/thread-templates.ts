// input:  UiServiceDeps + ThreadTemplatesGetParams (empty)
// output: threadTemplates.get handler → ThreadTemplateEntry[] — full body of every
//         thread-template JSON file under config/thread-templates/{templates,agents,shells}/
// pos:    query handler for 'threadTemplates.get' (plan §12 A item 3 / 9c). Pure
//         `readThreadTemplates(configDir)` + thin `handleThreadTemplatesGet` binding CONFIG_DIR.
//         No secrets in template JSON files; body is the full parsed content, null on parse error.
//         Kind order: templates → agents → shells. Within each kind: alphabetical by filename.
// >>> If I am updated, update CORTEX.md <<<

import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_DIR } from '@core/paths.js';
import type { UiServiceDeps, ThreadTemplatesGetParams, ThreadTemplateEntry } from '../types.js';

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readEntriesForKind(
  dir: string,
  kind: ThreadTemplateEntry['kind'],
): Promise<ThreadTemplateEntry[]> {
  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
    return Promise.all(
      jsonFiles.map(async (f) => {
        const name = f.slice(0, -'.json'.length);
        const body = await readJson(path.join(dir, f));
        const description =
          body && typeof body.description === 'string' ? body.description : null;
        return { kind, name, description, body };
      }),
    );
  } catch {
    return [];
  }
}

/**
 * Read all thread-template entries from config/thread-templates/{templates,agents,shells}/*.json.
 * Pure over configDir (hermetically testable). Returns templates first, then agents, then shells,
 * each group sorted alphabetically by basename. body is null when the file cannot be parsed.
 */
export async function readThreadTemplates(configDir: string): Promise<ThreadTemplateEntry[]> {
  const tt = path.join(configDir, 'thread-templates');
  const [templates, agents, shells] = await Promise.all([
    readEntriesForKind(path.join(tt, 'templates'), 'template'),
    readEntriesForKind(path.join(tt, 'agents'), 'agent'),
    readEntriesForKind(path.join(tt, 'shells'), 'shell'),
  ]);
  return [...templates, ...agents, ...shells];
}

export async function handleThreadTemplatesGet(
  _deps: UiServiceDeps,
  _params: ThreadTemplatesGetParams,
): Promise<ThreadTemplateEntry[]> {
  return readThreadTemplates(CONFIG_DIR);
}
