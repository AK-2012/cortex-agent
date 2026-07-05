// Thread template config loading and hot-reload.
// input:  DATA_DIR/thread-templates.json, prompts/ directory
// output: loadConfig / startConfigWatcher / stopConfigWatcher / getTemplate / getAgent / listTemplates / listAgents / resolvePluginDir

import { readFileSync, writeFileSync, existsSync, mkdirSync, watch, type FSWatcher } from 'fs';
import * as path from 'path';
import { CONFIG_DIR, DATA_DIR, PROMPTS_DIR } from '@core/utils.js';
import { createLogger } from '@core/log.js';
import { Icons } from '../../core/icons.js';
import { resolveTemplate } from './template-resolver.js';
import { isShellBinding, expandShellTemplate } from './shell-templates.js';
import type { AgentDefinition, ThreadTemplate, ThreadConfigFile } from '@core/types/thread-types.js';

const log = createLogger('thread-manager');
const CONFIG_FILE = path.join(CONFIG_DIR, 'thread-templates.json');
export const FILE_REF_PREFIX = 'file:';
const FIELD_DIRS: Record<string, string> = {
  directive: 'directives',
  promptTemplate: 'promptTemplates',
  systemPrompt: 'systemPrompts',
};

let agents: Record<string, AgentDefinition> = {};
let templates: Record<string, ThreadTemplate> = {};

// --- Admin notification (hot-reload → Slack) ---
let _adminNotifier: ((text: string) => void) | null = null;
export function setAdminNotifier(fn: (text: string) => void): void { _adminNotifier = fn; }

// --- File reference resolution ---
// Fields support "file:filename.md" syntax to read content from prompts/<subdir>/filename.md

/** Resolve a "file:<name>" reference for a given field. Returns value unchanged if not a file ref.
 *  Exported so prompt-builder.ts can resolve file refs on per-template agent overrides. */
export function resolveFileRef(field: string, value: string | undefined): string | undefined {
  if (!value || !value.startsWith(FILE_REF_PREFIX)) return value;
  const filename = value.slice(FILE_REF_PREFIX.length);
  const subdir = FIELD_DIRS[field];
  if (!subdir) return value;
  const filePath = path.join(PROMPTS_DIR, subdir, filename);
  try {
    const raw = readFileSync(filePath, 'utf8');
    const tplDir = path.join(PROMPTS_DIR, subdir, 'templates');
    return resolveTemplate(raw, tplDir);
  } catch (e: any) {
    log.error(`Failed to read ${field} file ref "${value}": ${e.message}`);
    return value;
  }
}

function resolveAgentFileRefs(agent: AgentDefinition): void {
  const resolved = resolveFileRef('directive', agent.directive);
  if (resolved !== undefined) agent.directive = resolved;
  const resolvedPT = resolveFileRef('promptTemplate', agent.promptTemplate);
  if (resolvedPT !== undefined) agent.promptTemplate = resolvedPT;
  const resolvedSP = resolveFileRef('systemPrompt', agent.systemPrompt);
  if (resolvedSP !== undefined) agent.systemPrompt = resolvedSP;
  if (agent.stages) {
    for (const stage of Object.values(agent.stages)) {
      const r = resolveFileRef('promptTemplate', stage.promptTemplate);
      if (r !== undefined) stage.promptTemplate = r;
    }
  }
}

/** Resolve a plugin directory path. Absolute paths are returned as-is;
 *  relative paths are resolved against DATA_DIR (plugins live under DATA_DIR/plugins/). */
export function resolvePluginDir(dir: string): string {
  if (path.isAbsolute(dir)) return dir;
  return path.join(DATA_DIR, dir);
}

// --- Config merging (init) ---

/**
 * Merge defaults thread-templates.json into the user's config.
 * - Agents/templates not in user config → added from defaults.
 * - Agents/templates already in user config → preserved as-is (never overwritten).
 * - If user config doesn't exist → copy defaults in full.
 * - Malformed user config → replace with defaults.
 *
 * @returns true if the user config file was written, false if no changes were needed.
 */
export function mergeThreadTemplates(defaultsPath: string, userConfigPath: string): boolean {
  // 1. Read defaults
  let defaults: ThreadConfigFile;
  try {
    const raw = readFileSync(defaultsPath, 'utf8');
    defaults = JSON.parse(raw);
  } catch (e: any) {
    log.warn(`Cannot read default thread-templates.json from ${defaultsPath}: ${e.message}`);
    return false;
  }

  const defaultAgents = defaults.agents || {};
  const defaultTemplates = defaults.templates || {};

  // 2. User config doesn't exist yet — copy defaults as-is
  if (!existsSync(userConfigPath)) {
    const dir = path.dirname(userConfigPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(userConfigPath, JSON.stringify(defaults, null, 2) + '\n', 'utf8');
    log.info('thread-templates.json created from defaults');
    return true;
  }

  // 3. Parse existing user config
  let userConfig: ThreadConfigFile;
  try {
    const raw = readFileSync(userConfigPath, 'utf8');
    userConfig = JSON.parse(raw);
  } catch (e: any) {
    log.warn(`Failed to parse existing thread-templates.json (${e.message}), falling back to defaults`);
    writeFileSync(userConfigPath, JSON.stringify(defaults, null, 2) + '\n', 'utf8');
    return true;
  }

  const userAgents: Record<string, any> = { ...(userConfig.agents || {}) };
  const userTemplates: Record<string, any> = { ...(userConfig.templates || {}) };

  let changed = false;

  // 4. Add new agents from defaults that don't exist in user config
  for (const [name, agent] of Object.entries(defaultAgents)) {
    if (!userAgents[name]) {
      userAgents[name] = agent;
      log.info(`Added new agent to thread-templates.json: ${name}`);
      changed = true;
    }
  }

  // 5. Add new templates from defaults that don't exist in user config
  for (const [name, template] of Object.entries(defaultTemplates)) {
    if (!userTemplates[name]) {
      userTemplates[name] = template;
      log.info(`Added new template to thread-templates.json: ${name}`);
      changed = true;
    }
  }

  // 6. Only write if something changed
  if (changed) {
    const merged: ThreadConfigFile = { agents: userAgents, templates: userTemplates };
    writeFileSync(userConfigPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    log.info('thread-templates.json merged with defaults');
  }

  return changed;
}

// --- Config loading ---

export function loadConfig(): { agents: Record<string, AgentDefinition>; templates: Record<string, ThreadTemplate> } {
  try {
    const data: ThreadConfigFile = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    agents = data.agents || {};
    for (const agent of Object.values(agents)) {
      resolveAgentFileRefs(agent);
      if (agent.pluginDirs) {
        agent.pluginDirs = agent.pluginDirs.map(resolvePluginDir);
      }
    }
    // Expand shell-binding templates into full templates (agents must be loaded first).
    // A single malformed binding is skipped (logged) so the rest of the config still loads.
    templates = {};
    for (const [name, entry] of Object.entries(data.templates || {})) {
      if (isShellBinding(entry)) {
        try {
          templates[name] = expandShellTemplate(name, entry, agents);
        } catch (e: any) {
          log.error(`Skipping template "${name}": ${e.message}`);
        }
      } else {
        templates[name] = entry as ThreadTemplate;
      }
    }
    log.info(`Loaded ${Object.keys(agents).length} agents, ${Object.keys(templates).length} templates`);
  } catch (e: any) {
    log.error(`Failed to load config: ${e.message}`);
    agents = {};
    templates = {};
  }
  return { agents, templates };
}

// --- Config hot-reload ---
// Watches thread-templates.json for external changes and reloads on modification.
// Re-creates watcher on 'rename' events because atomic file replacement
// (temp+rename, used by Claude Code's Write tool) changes the inode,
// causing the old fs.watch to stop receiving events.

let _watcher: FSWatcher | null = null;
let _reloadTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleConfigReload(): void {
  if (_reloadTimer) clearTimeout(_reloadTimer);
  _reloadTimer = setTimeout(() => {
    _reloadTimer = null;
    log.info('Detected change in thread-templates.json, reloading...');
    _adminNotifier?.(`${Icons.refresh} \`thread-templates.json\` hot-reloaded`);
    loadConfig();
  }, 300);
}

function setupConfigWatch(): void {
  try {
    if (_watcher) _watcher.close();
    _watcher = watch(CONFIG_FILE, (eventType) => {
      if (eventType === 'rename') setTimeout(() => setupConfigWatch(), 100);
      scheduleConfigReload();
    });
  } catch (e: any) {
    log.error(`Failed to watch ${CONFIG_FILE}: ${e.message}`);
  }
}

// --- Prompts directory hot-reload ---

let _promptsWatchers: FSWatcher[] = [];
let _promptsReloadTimer: ReturnType<typeof setTimeout> | null = null;

function startPromptsWatcher(): void {
  stopPromptsWatcher();
  for (const subdir of Object.values(FIELD_DIRS)) {
    for (const rel of [subdir, `${subdir}/templates`]) {
      const dir = path.join(PROMPTS_DIR, rel);
      try {
        if (!existsSync(dir)) continue;
        const w = watch(dir, (_eventType, filename) => {
          if (_promptsReloadTimer) clearTimeout(_promptsReloadTimer);
          _promptsReloadTimer = setTimeout(() => {
            _promptsReloadTimer = null;
            log.info(`Detected change in prompts/${rel}/${filename || '?'}, reloading config...`);
            _adminNotifier?.(`${Icons.refresh} prompts/\`${rel}/${filename || '?'}\` changed — thread-templates reloaded`);
            loadConfig();
          }, 300);
        });
        _promptsWatchers.push(w);
      } catch (e: any) {
        log.error(`Failed to watch prompts/${rel}: ${e.message}`);
      }
    }
  }
}

function stopPromptsWatcher(): void {
  for (const w of _promptsWatchers) w.close();
  _promptsWatchers = [];
  if (_promptsReloadTimer) {
    clearTimeout(_promptsReloadTimer);
    _promptsReloadTimer = null;
  }
}

export function startConfigWatcher(): void {
  setupConfigWatch();
  startPromptsWatcher();
}

export function stopConfigWatcher(): void {
  if (_watcher) {
    _watcher.close();
    _watcher = null;
  }
  if (_reloadTimer) {
    clearTimeout(_reloadTimer);
    _reloadTimer = null;
  }
  stopPromptsWatcher();
}

// --- Agent and template lookup ---

export function getAgent(name: string): AgentDefinition | null {
  return agents[name] || null;
}

export function listAgents(): AgentDefinition[] {
  return Object.values(agents);
}

export function getTemplate(name: string): ThreadTemplate | null {
  return templates[name] || null;
}

export function listTemplates(): ThreadTemplate[] {
  return Object.values(templates);
}

export function listTemplateNames(): string[] {
  return Object.keys(templates);
}
