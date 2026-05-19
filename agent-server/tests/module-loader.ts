// input:  relative test module paths
// output: ESM fresh import + root path helpers
// pos:    tests/ shared ESM helper utilities
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGENT_SERVER_DIR = path.resolve(TESTS_DIR, '..');

async function importFresh(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set('ts', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return import(url.href);
}

function toFileUrl(relativePath) {
  return pathToFileURL(path.resolve(TESTS_DIR, relativePath)).href;
}

export { AGENT_SERVER_DIR, TESTS_DIR, importFresh, toFileUrl };
