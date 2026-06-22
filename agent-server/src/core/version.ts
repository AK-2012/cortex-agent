// input:  package.json (read at module load)
// output: CORTEX_VERSION string (CalVer: YYYY.M.D, no zero-padding); CORTEX_DOCS_URL (docs site)
// pos:    single source of truth for Cortex version — imported by MCP servers and anywhere else
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INSTALL_ROOT } from './paths.js';

const pkgPath = join(INSTALL_ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

/** Cortex version — reads from package.json at module load time.
 *  Format: CalVer `YYYY.M.D` (no zero-padding), e.g. `2026.5.19`. */
export const CORTEX_VERSION: string = pkg.version;

/** Canonical Cortex usage documentation site. Single source of truth for the
 *  docs URL injected into system prompts (see store/version-migrations.ts docs block). */
export const CORTEX_DOCS_URL = 'https://fangxm233.github.io/cortex-agent/';
