// input:  project-dirs.json (+ channel-registry.json for reverse lookup)
// output: ProjectDirRepo (async getProjectDir / setProjectDir / removeProjectDir / getAllProjectDirs / getChannelProject)
// pos:    Project-device code directory mapping persistence layer. Based on JsonRepository abstraction, AsyncMutex serializes reads/writes of project-dirs.json.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as path from 'path';
import { JsonRepository } from './json-repository.js';
import { STORE_DIR } from '@core/paths.js';
import { ChannelRepo, channelRepo } from './channel-repo.js';

const PROJECT_DIRS_FILE = path.join(STORE_DIR, 'project-dirs.json');

/** Shape of project-dirs.json: `{"projectName": {"machineName": "dirPath", ...}, ...}` */
export type ProjectDirsData = Record<string, Record<string, string>>;

interface ProjectDirRepoOptions {
  filePath?: string;
  channelRepoOverride?: ChannelRepo;
}

export class ProjectDirRepo {
  private readonly _repo: JsonRepository<ProjectDirsData>;
  private readonly _channelRepo: ChannelRepo;

  constructor(opts: ProjectDirRepoOptions = {}) {
    this._repo = new JsonRepository<ProjectDirsData>({
      filePath: opts.filePath ?? PROJECT_DIRS_FILE,
      defaultValue: () => ({}),
      migrate: (raw) => (typeof raw === 'object' && raw !== null ? (raw as ProjectDirsData) : ({})),
    });
    this._channelRepo = opts.channelRepoOverride ?? channelRepo;
  }

  async getProjectDir(project: string, machine: string): Promise<string | null> {
    const data = await this._repo.read();
    return (data[project] && data[project][machine]) ?? null;
  }

  async setProjectDir(project: string, machine: string, dirPath: string): Promise<void> {
    await this._repo.mutate((data) => {
      if (!data[project]) data[project] = {};
      data[project][machine] = dirPath;
      return { next: data, result: undefined };
    });
  }

  async removeProjectDir(project: string, machine: string): Promise<void> {
    await this._repo.mutate((data) => {
      if (data[project]) {
        delete data[project][machine];
        if (Object.keys(data[project]).length === 0) delete data[project];
      }
      return { next: data, result: undefined };
    });
  }

  async getAllProjectDirs(): Promise<Record<string, Record<string, string>>> {
    return { ...(await this._repo.read()) };
  }

  /** Reverse-lookup: channelId → project name (via channel-registry.json). */
  async getChannelProject(channelId: string): Promise<string | null> {
    const channelReg = await this._channelRepo.getAllRegistrations();
    for (const [project, ch] of Object.entries(channelReg)) {
      if (ch === channelId) return project;
    }
    return null;
  }

  /** Wait for any in-flight mutate() to complete. For graceful SIGTERM drain. */
  flush(): Promise<void> {
    return this._repo.flush();
  }
}

export const projectDirRepo = new ProjectDirRepo();
