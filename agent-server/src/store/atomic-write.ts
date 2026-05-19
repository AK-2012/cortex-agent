// input:  filePath, data string
// output: atomic file write (tmp → rename)
// pos:    write primitive used by JsonRepository; guarantees original is never partially overwritten
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Write `data` to `filePath` atomically via a sibling tmp file + fs.rename.
 * The original file is never in a partially-written state: either the rename
 * succeeds (new content visible) or it does not (original intact, tmp left on disk).
 */
export async function atomicWrite(filePath: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const rnd = Math.random().toString(36).slice(2, 8);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${rnd}`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}
