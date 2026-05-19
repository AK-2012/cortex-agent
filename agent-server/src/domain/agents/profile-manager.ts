// input:  profiles.json config file (I/O delegated to store/profile-repo.ts)
// output: load/list/get/resolveProfile + validate helpers
// pos:    named agent profile resolution and fallback config chain. Business validation (validateProfilesFile) stays in this file,
//         JSON I/O goes through profileRepo (Pattern A, DR-s12-gate). Public API maintains sync semantics.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<
import { profileRepo } from '@store/profile-repo.js';

export interface ProfileEntry {
  model: string;
  backend?: string;
  mode?: string;
  extraEnv?: Record<string, string>;
  extraOption?: Record<string, string>;
  /** DR-0012: opt into TUI-mode Claude (interactive tmux + jsonl tail). Default 'print' for backward
   *  compatibility. Only meaningful when backend='claude'. Other backends ignore the field. */
  claudeBackend?: 'print' | 'tui';
  fallback?: ProfileEntry[];
}

export interface ProfilesFile {
  defaultProfile: string;
  profiles: Record<string, ProfileEntry>;
}

export interface ResolvedProfile extends ProfileEntry {
  name: string;
}

export interface ResolvedProfileConfig {
  name: string;
  model: string;
  backend: string;
  mode: string | null;
  extraEnv: Record<string, string>;
  extraOption: Record<string, string>;
  /** DR-0012: resolved claude adapter mode. 'print' (default, uses -p + stream-json) or 'tui'
   *  (interactive Claude under tmux + jsonl tail). Ignored for non-claude backends. */
  claudeBackend: 'print' | 'tui';
  fallback: Array<{ model: string; backend: string; mode: string | null; extraEnv: Record<string, string>; extraOption: Record<string, string>; claudeBackend: 'print' | 'tui' }>;
}

const PROFILE_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const MODE_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const VALID_BACKENDS = new Set(['claude', 'codex', 'pi']);

function loadProfilesFile(): ProfilesFile {
  try {
    const data = profileRepo.readSync();
    validateProfilesFile(data);
    return data;
  } catch (error) {
    throw new Error(`Failed to load profiles.json: ${(error as Error).message}`);
  }
}

function validateProfileEntry(profile: unknown, label: string): void {
  const p = profile as Record<string, unknown>;
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    throw new Error(`${label} must be an object`);
  }
  if (!p.model || typeof p.model !== 'string') {
    throw new Error(`${label} must define a non-empty string model`);
  }
  if (p.backend !== undefined && !VALID_BACKENDS.has(p.backend as string)) {
    throw new Error(`${label} has invalid backend: ${p.backend}`);
  }
  if (p.mode !== undefined) {
    if (typeof p.mode !== 'string' || !MODE_NAME_RE.test(p.mode)) {
      throw new Error(`${label} has invalid mode: ${p.mode}`);
    }
  }
  if (p.extraEnv !== undefined) {
    if (!p.extraEnv || typeof p.extraEnv !== 'object' || Array.isArray(p.extraEnv)) {
      throw new Error(`${label} extraEnv must be a plain object`);
    }
    for (const [k, v] of Object.entries(p.extraEnv as Record<string, unknown>)) {
      if (!ENV_KEY_RE.test(k)) {
        throw new Error(`${label} extraEnv has invalid key: ${k}`);
      }
      if (typeof v !== 'string') {
        throw new Error(`${label} extraEnv["${k}"] must be a string`);
      }
    }
  }
  if (p.extraOption !== undefined) {
    if (!p.extraOption || typeof p.extraOption !== 'object' || Array.isArray(p.extraOption)) {
      throw new Error(`${label} extraOption must be a plain object`);
    }
    for (const [k, v] of Object.entries(p.extraOption as Record<string, unknown>)) {
      if (typeof k !== 'string' || !k.startsWith('--')) {
        throw new Error(`${label} extraOption key must start with --: ${k}`);
      }
      if (typeof v !== 'string') {
        throw new Error(`${label} extraOption["${k}"] must be a string`);
      }
    }
  }
  if (p.claudeBackend !== undefined) {
    if (p.claudeBackend !== 'print' && p.claudeBackend !== 'tui') {
      throw new Error(`${label} has invalid claudeBackend: ${String(p.claudeBackend)} (expected 'print' or 'tui')`);
    }
  }
}

/**
 * Pure resolver: maps a ProfileEntry's claudeBackend field to one of the two valid modes.
 * Defaults to 'print' for any non-'tui' value (including missing field). Used at adapter dispatch
 * time so unknown/legacy values silently fall back to the safe 'print' path.
 */
export function resolveClaudeBackend(p: { claudeBackend?: unknown }): 'print' | 'tui' {
  return p.claudeBackend === 'tui' ? 'tui' : 'print';
}

function validateProfilesFile(data: unknown): void {
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    throw new Error('top-level value must be an object');
  }

  const { defaultProfile, profiles } = d;
  if (!defaultProfile || typeof defaultProfile !== 'string') {
    throw new Error('defaultProfile must be a non-empty string');
  }
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new Error('profiles must be an object');
  }
  const profs = profiles as Record<string, unknown>;
  if (!profs[defaultProfile]) {
    throw new Error(`defaultProfile "${defaultProfile}" is missing from profiles`);
  }

  for (const [name, profile] of Object.entries(profs)) {
    if (!PROFILE_NAME_RE.test(name)) {
      throw new Error(`invalid profile name: ${name}`);
    }
    validateProfileEntry(profile, `profile "${name}"`);
    const pe = profile as Record<string, unknown>;
    if (pe.fallback !== undefined) {
      if (!Array.isArray(pe.fallback)) {
        throw new Error(`profile "${name}" fallback must be an array`);
      }
      pe.fallback.forEach((fb: unknown, i: number) => {
        validateProfileEntry(fb, `profile "${name}" fallback[${i}]`);
      });
    }
  }
}

function listProfiles(): ResolvedProfile[] {
  const data = loadProfilesFile();
  return Object.entries(data.profiles).map(([name, profile]) => ({ name, ...profile }));
}

function getDefaultProfileName(): string {
  return loadProfilesFile().defaultProfile;
}

function getProfile(name: string | null): ResolvedProfile | null {
  if (!name) return null;
  const data = loadProfilesFile();
  const profile = data.profiles[name];
  return profile ? { name, ...profile } : null;
}

function resolveProfile(name: string | null = null): ResolvedProfile {
  const data = loadProfilesFile();
  const resolvedName = name || data.defaultProfile;
  const profile = data.profiles[resolvedName];
  if (!profile) {
    throw new Error(`Unknown profile: ${resolvedName}`);
  }
  return { name: resolvedName, ...profile };
}

function getProfileModel(name: string | null = null): string {
  return resolveProfile(name).model;
}

function resolveProfileConfig(name: string | null = null): ResolvedProfileConfig {
  const data = loadProfilesFile();
  const resolvedName = name || data.defaultProfile;
  const profile = data.profiles[resolvedName];
  if (!profile) {
    throw new Error(`Unknown profile: ${resolvedName}`);
  }
  const primary = {
    model: profile.model,
    backend: profile.backend || 'claude',
    mode: profile.mode || null,
    extraEnv: { ...(profile.extraEnv || {}) },
    extraOption: { ...(profile.extraOption || {}) },
    claudeBackend: resolveClaudeBackend(profile),
  };
  const fallback = (profile.fallback || []).map(fb => ({
    model: fb.model,
    backend: fb.backend || primary.backend,
    mode: fb.mode || primary.mode,
    extraEnv: { ...(fb.extraEnv || {}) },
    extraOption: { ...(fb.extraOption || {}) },
    claudeBackend: fb.claudeBackend !== undefined ? resolveClaudeBackend(fb) : primary.claudeBackend,
  }));
  return { name: resolvedName, ...primary, fallback };
}

export {
  loadProfilesFile,
  listProfiles,
  getDefaultProfileName,
  getProfile,
  resolveProfile,
  getProfileModel,
  resolveProfileConfig,
  validateProfilesFile,
};
// resolveClaudeBackend is already an `export function` above; named here for discoverability of the public surface.
