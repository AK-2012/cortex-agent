// input:  PROJECTS_DIR (from @core/paths.js or constructor arg)
// output: ProjectStore — list / get / exists / getDefault / resolveFromMessage / refresh
//         + auto-scaffold of general/ project on first initialize()
// pos:    Read-only project registry with fs.watch cache invalidation
//         "general" is always synthesized; never persisted.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PROJECTS_DIR } from '@core/paths.js';
import { createLogger } from '@core/log.js';
import type { Project } from './project-types.js';

const log = createLogger('project-store');

const DEBOUNCE_MS = 1000;
const GENERAL_SCAFFOLD_STATUS = `# general

Status: active

`;
const GENERAL_SCAFFOLD_CORTEX = `# general

Synthetic umbrella project — always present. Created automatically by the system.
`;

export interface ProjectStoreOptions {
  /** Overrideable for tests. Defaults to PROJECTS_DIR from @core/paths. */
  projectsDir?: string;
  /** Disable fs.watch — for tests that manipulate dirs synchronously. Defaults to true. */
  watchEnabled?: boolean;
}

export class ProjectStore {
  private readonly projectsDir: string;
  private readonly watchEnabled: boolean;
  private projects: Project[] = [];
  private initialized = false;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ProjectStoreOptions = {}) {
    this.projectsDir = opts.projectsDir ?? PROJECTS_DIR;
    this.watchEnabled = opts.watchEnabled ?? true;
  }

  /**
   * Scan PROJECTS_DIR, scaffold general if absent, build cache, start watcher.
   * Idempotent — safe to call multiple times.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.scaffoldGeneral();
    this.scan();
    this.initialized = true;

    if (this.watchEnabled) {
      this.startWatcher();
    }

    log.info(`ProjectStore initialized: ${this.projects.length} projects (${this.projectsDir})`);
  }

  /** Return all known projects. Always includes "general". */
  list(): Project[] {
    return [...this.projects];
  }

  /** Look up a project by id. Returns undefined for unknown ids. */
  get(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id);
  }

  /** True if a project with the given id exists. */
  exists(id: string): boolean {
    return this.projects.some((p) => p.id === id);
  }

  /** Return the "general" umbrella project. Always present. */
  getDefault(): Project {
    // Guaranteed to exist after initialize()
    return this.projects.find((p) => p.kind === 'general')!;
  }

  /**
   * Resolve a project from a message string using heuristic patterns.
   *
   * Matches:
   *   "Project: <name>"       — inline project reference
   *   "**Project:** <name>"   — markdown bold project reference
   *
   * Returns the matching Project or null.
   */
  resolveFromMessage(msg: string): Project | null {
    const match = msg.match(/\*{0,2}Project:\*{0,2}\s+(\S+)/);
    if (!match) return null;
    const projectId = match[1];
    return this.get(projectId) ?? null;
  }

  /** Force a rescan of PROJECTS_DIR (e.g. after watcher event or manual trigger). */
  refresh(): void {
    this.scan();
  }

  /** Stop the fs.watch watcher and release resources. */
  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.initialized = false;
  }

  // ── Private ──────────────────────────────────────────────────

  /** Create general/ scaffold if the directory does not exist. */
  private scaffoldGeneral(): void {
    const generalDir = path.join(this.projectsDir, 'general');
    if (fs.existsSync(generalDir)) return;

    fs.mkdirSync(generalDir, { recursive: true });
    fs.writeFileSync(path.join(generalDir, 'STATUS.md'), GENERAL_SCAFFOLD_STATUS, 'utf8');
    fs.writeFileSync(path.join(generalDir, 'CORTEX.md'), GENERAL_SCAFFOLD_CORTEX, 'utf8');
    log.info(`Scaffolded general project at ${generalDir}`);
  }

  /** Read PROJECTS_DIR and rebuild the in-memory cache. */
  private scan(): void {
    const result: Project[] = [];

    // Always synthesize "general"
    result.push(this.makeGeneralProject());

    // Enumerate real project directories
    try {
      const entries = fs.readdirSync(this.projectsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        if (entry.name === 'general') continue; // already added
        result.push({
          id: entry.name,
          name: entry.name,
          kind: 'user',
          contextDir: path.join(this.projectsDir, entry.name),
        });
      }
    } catch {
      // PROJECTS_DIR missing or unreadable — only "general" will be present
    }

    this.projects = result;
  }

  private makeGeneralProject(): Project {
    return {
      id: 'general',
      name: 'general',
      kind: 'general',
      contextDir: path.join(this.projectsDir, 'general'),
    };
  }

  /** Watch PROJECTS_DIR for add/remove of subdirectories. */
  private startWatcher(): void {
    try {
      this.watcher = fs.watch(this.projectsDir, (eventType, filename) => {
        // On Linux 'rename' fires for create/delete; filter to directory-relevant events
        if (!filename) return;
        // Ignore events for dotfiles and non-directory files (we can't easily check
        // what type the changed entry is from the event alone, so we just debounce-scan)
        if (filename.startsWith('.')) return;

        this.debouncedRescan();
      });

      this.watcher.on('error', (err) => {
        log.error(`Watcher error for ${this.projectsDir}:`, err.message);
      });
    } catch (err) {
      log.error(`Failed to start watcher for ${this.projectsDir}:`, err);
    }
  }

  private debouncedRescan(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.scan();
      log.debug(`Rescanned projects after directory change`);
    }, DEBOUNCE_MS);
  }
}

// --- Singleton ---

export const projectStore = new ProjectStore();
