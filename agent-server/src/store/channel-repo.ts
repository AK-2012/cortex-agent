// input:  channel-registry.json + context/projects/ directory
// output: ChannelRepo (async getProjectChannel / setProjectChannel / removeProjectChannel / getAllRegistrations / listProjects)
// pos:    Project-Channel mapping persistence layer. Based on JsonRepository abstraction, AsyncMutex serializes reads/writes of channel-registry.json.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as fsSync from 'fs';
import * as path from 'path';
import { JsonRepository } from './json-repository.js';
import { STORE_DIR, PROJECTS_DIR } from '@core/paths.js';

export const CHANNEL_REGISTRY_FILE = path.join(STORE_DIR, 'channel-registry.json');

/** Shape of channel-registry.json: `{"projectName": "channelId", ...}` */
export type ChannelRegistryData = Record<string, string>;

interface ChannelRepoOptions {
  filePath?: string;
  projectsDir?: string;
  /** Callback for listing project names. When set, listProjects() delegates here
   *  instead of reading the filesystem. Wired from app.ts (composition root). */
  projectLister?: () => string[];
}

export class ChannelRepo {
  private readonly _repo: JsonRepository<ChannelRegistryData>;
  private readonly _projectsDir: string;
  private _projectLister: (() => string[]) | null = null;

  constructor(opts: ChannelRepoOptions = {}) {
    this._repo = new JsonRepository<ChannelRegistryData>({
      filePath: opts.filePath ?? CHANNEL_REGISTRY_FILE,
      defaultValue: () => ({}),
      migrate: (raw) => (typeof raw === 'object' && raw !== null ? (raw as ChannelRegistryData) : ({})),
    });
    this._projectsDir = opts.projectsDir ?? PROJECTS_DIR;
    this._projectLister = opts.projectLister ?? null;
  }

  async getProjectChannel(project: string): Promise<string | null> {
    const data = await this._repo.read();
    return data[project] ?? null;
  }

  async setProjectChannel(project: string, channelId: string): Promise<void> {
    await this._repo.mutate((data) => {
      data[project] = channelId;
      return { next: data, result: undefined };
    });
  }

  async removeProjectChannel(project: string): Promise<void> {
    await this._repo.mutate((data) => {
      delete data[project];
      return { next: data, result: undefined };
    });
  }

  async getAllRegistrations(): Promise<Record<string, string>> {
    return { ...(await this._repo.read()) };
  }

  async listProjects(): Promise<string[]> {
    if (this._projectLister) {
      return this._projectLister();
    }
    try {
      return fsSync.readdirSync(this._projectsDir).filter((name) => {
        return fsSync.statSync(path.join(this._projectsDir, name)).isDirectory() && !name.startsWith('.');
      });
    } catch {
      return [];
    }
  }

  /** Late injection of project lister callback (used by app.ts composition root). */
  setProjectLister(lister: () => string[]): void {
    this._projectLister = lister;
  }

  /** Wait for any in-flight mutate() to complete. For graceful SIGTERM drain. */
  flush(): Promise<void> {
    return this._repo.flush();
  }
}

export const channelRepo = new ChannelRepo();
