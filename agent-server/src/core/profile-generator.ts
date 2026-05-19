// input:  DiscoveredEndpoint[], profile-manager types, fs, path
// output: generateProfiles / mergeProfilesJson / writeProfilesJson / listChoices
//         — produce profiles.json content from discovered models
// pos:    init-time profiles.json auto-generation. Names are unsuffixed (`plan`, `execute`);
//         users can override via explicit (mode, model) choices from `cortex init`.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { DiscoveredEndpoint } from './gateway-generator.js';
import { createLogger } from './log.js';

const log = createLogger('profile-generator');

// ─── Types ────────────────────────────────────────────────────────

interface ProfileEntry {
  model: string;
  backend: string;
  mode: string;
  fallback?: ProfileEntry[];
  extraEnv?: Record<string, string>;
  extraOption?: Record<string, string>;
}

interface ProfilesFile {
  defaultProfile: string;
  profiles: Record<string, ProfileEntry>;
}

/** A (mode, model) pair the user can pick as the source for plan/execute. */
export interface ModelChoice {
  mode: string;
  model: string;
}

export interface GenerateOpts {
  /** Explicit (mode, model) to use as the `plan` profile. Otherwise auto-inferred from anthropic max-tier. */
  planChoice?: ModelChoice;
  /** Explicit (mode, model) to use as the `execute` profile. Otherwise auto-inferred (non-Claude-Code mid-tier preferred). */
  executeChoice?: ModelChoice;
}

// ─── Model tier classification ────────────────────────────────────

/** Determine model tier: "max", "mid", or "budget". */
function classifyTier(model: string): 'max' | 'mid' | 'budget' {
  const lower = model.toLowerCase();
  if (lower.includes('opus') || lower.includes('pro') || lower.includes('gpt-5')) return 'max';
  if (lower.includes('sonnet') || lower.includes('flash') || lower.includes('mini')) return 'mid';
  if (lower.includes('haiku') || lower.includes('lite')) return 'budget';
  return 'mid'; // default
}

// ─── Endpoint → backend mapping ────────────────────────────────────

/**
 * Determine the Cortex backend from endpoint and mode.
 * - anthropic endpoint with plan/api mode → claude
 * - openai endpoint → codex
 * - everything else → pi (or claude if anthropic endpoint)
 */
function resolveBackend(endpoint: string, mode: string): string {
  if (endpoint === 'anthropic' && (mode === 'plan' || mode === 'api')) {
    return 'claude';
  }
  if (endpoint === 'openai') {
    return 'codex';
  }
  if (endpoint === 'anthropic') {
    // Non-standard Anthropic mode (e.g., deepseek-anthropic) — can use claude or pi
    // PI handles anthropic-compatible APIs better for custom providers
    return 'pi';
  }
  return 'pi';
}

// ─── Profile generation ───────────────────────────────────────────

interface ModelEntry {
  model: string;
  backend: string;
  mode: string;
  tier: 'max' | 'mid' | 'budget';
  endpoint: string;
}

/** Flatten all discovered endpoints into a list of (model, backend, mode) entries. */
function flattenModels(endpoints: DiscoveredEndpoint[]): ModelEntry[] {
  const entries: ModelEntry[] = [];
  for (const ep of endpoints) {
    const backend = resolveBackend(ep.endpoint, ep.mode);
    for (const model of ep.models) {
      entries.push({
        model,
        backend,
        mode: ep.mode,
        tier: classifyTier(model),
        endpoint: ep.endpoint,
      });
    }
  }
  return entries;
}

/** Pick the best model for a given tier and preferred endpoint. */
function pickModel(
  models: ModelEntry[],
  tier: 'max' | 'mid' | 'budget',
  preferEndpoint?: string,
): ModelEntry | null {
  // Prefer specific endpoint
  if (preferEndpoint) {
    const match = models.filter(m => m.tier === tier && m.endpoint === preferEndpoint);
    if (match.length > 0) return match[0];
  }
  // Fallback to any endpoint
  const any = models.filter(m => m.tier === tier);
  if (any.length > 0) return any[0];

  // Downgrade tier
  if (tier === 'max') return pickModel(models, 'mid', preferEndpoint);
  if (tier === 'mid') return pickModel(models, 'budget', preferEndpoint);
  return null;
}

/** Build a fallback chain for a given model.
 *  Only includes models that are strictly lower-tier or from other endpoints. */
function buildFallbackChain(
  primary: ModelEntry,
  models: ModelEntry[],
): ProfileEntry[] {
  const fallbacks: ProfileEntry[] = [];
  const tierOrder: Record<string, number> = { max: 0, mid: 1, budget: 2 };
  const primaryRank = tierOrder[primary.tier] ?? 1;

  // Same endpoint, strictly lower tier (not same or higher)
  const sameEndpoint = models.filter(
    m => m.endpoint === primary.endpoint
      && m.model !== primary.model
      && (tierOrder[m.tier] ?? 1) > primaryRank,
  );
  sameEndpoint.sort((a, b) => (tierOrder[a.tier] ?? 1) - (tierOrder[b.tier] ?? 1));

  for (const m of sameEndpoint.slice(0, 2)) {
    fallbacks.push({ model: m.model, backend: m.backend, mode: m.mode });
  }

  // Cross-endpoint fallback (e.g., Claude → DeepSeek)
  const otherEndpoint = models.filter(m => m.endpoint !== primary.endpoint);
  otherEndpoint.sort((a, b) => (tierOrder[a.tier] ?? 1) - (tierOrder[b.tier] ?? 1));

  for (const m of otherEndpoint.slice(0, 2)) {
    fallbacks.push({ model: m.model, backend: m.backend, mode: m.mode });
  }

  return fallbacks;
}

/** Build profile entry from a ModelEntry, with optional extra config. */
function makeProfileEntry(
  m: ModelEntry,
  models: ModelEntry[],
  extraEnv?: Record<string, string>,
  extraOption?: Record<string, string>,
): ProfileEntry {
  return {
    model: m.model,
    backend: m.backend,
    mode: m.mode,
    fallback: buildFallbackChain(m, models),
    ...(extraEnv ? { extraEnv } : {}),
    ...(extraOption ? { extraOption } : {}),
  };
}

/** Locate a ModelEntry by explicit (mode, model). Throws if not found. */
function findModelEntry(models: ModelEntry[], choice: ModelChoice, label: string): ModelEntry {
  const match = models.find(m => m.mode === choice.mode && m.model === choice.model);
  if (!match) {
    throw new Error(
      `${label}: (mode="${choice.mode}", model="${choice.model}") not found among discovered models`,
    );
  }
  return match;
}

/** Generate profiles for DeepSeek models (if available in discovered endpoints). */
function generateDeepSeekProfiles(
  models: ModelEntry[],
): Record<string, ProfileEntry> {
  const result: Record<string, ProfileEntry> = {};

  const deepseekModels = models.filter(m =>
    m.model.toLowerCase().includes('deepseek'),
  );

  for (const dm of deepseekModels) {
    const isFlash = dm.model.toLowerCase().includes('flash');
    const profileName = isFlash ? 'deepseek-flash' : 'deepseek-pro';

    const extraEnv: Record<string, string> = {};
    const extraOption: Record<string, string> = {};

    if (dm.backend === 'claude') {
      // Claude Code requires these for non-Anthropic providers
      extraEnv.CLAUDE_CODE_ATTRIBUTION_HEADER = '0';
      extraEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
      extraEnv.CLAUDE_CODE_DISABLE_SESSION_METADATA = '1';
    } else if (dm.backend === 'pi' && !isFlash) {
      // DeepSeek pro with extended thinking via PI (only PI + DeepSeek non-flash)
      extraOption['--thinking'] = 'xhigh';
    }

    result[profileName] = {
      model: dm.model,
      backend: dm.backend,
      mode: dm.mode,
      ...(Object.keys(extraEnv).length > 0 ? { extraEnv } : {}),
      ...(Object.keys(extraOption).length > 0 ? { extraOption } : {}),
    };
  }

  return result;
}

/** Generate Codex profile if OpenAI models are available. */
function generateCodexProfile(models: ModelEntry[]): Record<string, ProfileEntry> {
  const openaiModels = models.filter(m => m.endpoint === 'openai');
  if (openaiModels.length === 0) return {};

  const best = openaiModels.find(m => m.tier === 'max') || openaiModels[0];
  const fallbacks: ProfileEntry[] = [];

  // Fallback: Anthropic sonnet
  const claudeMid = models.find(m => m.endpoint === 'anthropic' && m.tier === 'mid');
  if (claudeMid) {
    fallbacks.push({ model: claudeMid.model, backend: claudeMid.backend, mode: 'plan' });
  }

  return {
    codex: {
      model: best.model,
      backend: 'codex',
      mode: 'plan',
      fallback: fallbacks.length > 0 ? fallbacks : undefined,
    },
  };
}

// ─── Choice listing (for init UI) ─────────────────────────────────

/**
 * Flatten endpoints to a list of (mode, model) choices the user can pick from.
 * Ordered so Anthropic plan/api modes come first (recommended for `plan` profile).
 */
export function listChoices(endpoints: DiscoveredEndpoint[]): ModelChoice[] {
  const flat = flattenModels(endpoints);
  // Sort: anthropic+plan/api first (recommended for plan), then others.
  // Within each group, max-tier first.
  const tierOrder: Record<string, number> = { max: 0, mid: 1, budget: 2 };
  const isAnthropicNative = (m: ModelEntry) =>
    m.endpoint === 'anthropic' && (m.mode === 'plan' || m.mode === 'api');
  flat.sort((a, b) => {
    const aN = isAnthropicNative(a) ? 0 : 1;
    const bN = isAnthropicNative(b) ? 0 : 1;
    if (aN !== bN) return aN - bN;
    return (tierOrder[a.tier] ?? 1) - (tierOrder[b.tier] ?? 1);
  });
  return flat.map(m => ({ mode: m.mode, model: m.model }));
}

// ─── Main generation ──────────────────────────────────────────────

/**
 * Generate a profiles.json object from discovered endpoints.
 *
 * Naming: outputs unsuffixed `plan` and `execute` (no provider suffix).
 *
 * Selection rules:
 * - plan: explicit `opts.planChoice` if provided, else max-tier Anthropic.
 * - execute: explicit `opts.executeChoice` if provided, else prefer non-Claude-Code
 *   mid-tier (cost), fall back to Anthropic mid-tier, then max.
 *
 * Provider-specific profiles always layered on top:
 * - deepseek-flash / deepseek-pro: if DeepSeek models discovered. `--thinking xhigh`
 *   only on PI backend non-flash (the only PI + DeepSeek combo that should get it).
 * - codex: if OpenAI models discovered.
 */
export function generateProfiles(
  endpoints: DiscoveredEndpoint[],
  opts: GenerateOpts = {},
): ProfilesFile {
  const models = flattenModels(endpoints);

  if (models.length === 0) {
    // Minimal fallback — user needs to log in first
    return {
      defaultProfile: 'plan',
      profiles: {
        plan: { model: 'opus', backend: 'claude', mode: 'plan' },
      },
    };
  }

  const profiles: Record<string, ProfileEntry> = {};
  const anthropicModels = models.filter(
    m => m.endpoint === 'anthropic' && (m.mode === 'plan' || m.mode === 'api'),
  );

  // ── plan ──
  const planEntry = opts.planChoice
    ? findModelEntry(models, opts.planChoice, 'planChoice')
    : pickModel(anthropicModels, 'max');
  if (planEntry) {
    profiles.plan = makeProfileEntry(planEntry, models);
  }

  // ── execute ──
  let executeEntry: ModelEntry | null;
  if (opts.executeChoice) {
    executeEntry = findModelEntry(models, opts.executeChoice, 'executeChoice');
  } else {
    // Prefer mid-tier non-Anthropic-native models for cost savings
    const nonClaudeMid = models.find(m =>
      m.tier === 'mid' && !(m.endpoint === 'anthropic' && (m.mode === 'plan' || m.mode === 'api')),
    );
    executeEntry = nonClaudeMid || pickModel(anthropicModels, 'mid') || pickModel(anthropicModels, 'max');
  }
  if (executeEntry) {
    profiles.execute = makeProfileEntry(executeEntry, models);
  }

  // ── Provider-specific profiles ──
  Object.assign(profiles, generateDeepSeekProfiles(models));
  Object.assign(profiles, generateCodexProfile(models));

  return { defaultProfile: 'plan', profiles };
}

// ─── File I/O ─────────────────────────────────────────────────────

/**
 * Merge generated profiles into existing profiles.json.
 * - Non-(plan/execute) existing profiles are always preserved.
 * - For `plan` and `execute`: `overwrite=true` replaces them with generated;
 *   `overwrite=false` (default) preserves existing user customization.
 * - defaultProfile is only updated if the current default doesn't exist in merged.
 */
export function mergeProfilesJson(
  generated: ProfilesFile,
  outputDir?: string,
  overwrite: boolean = false,
): ProfilesFile {
  const existingPath = outputDir
    ? path.join(outputDir, 'profiles.json')
    : path.join(os.homedir(), '.cortex', 'config', 'profiles.json');

  let existing: ProfilesFile | null = null;

  try {
    if (existsSync(existingPath)) {
      existing = JSON.parse(readFileSync(existingPath, 'utf-8'));
    }
  } catch (e) {
    log.warn(`Failed to read existing profiles.json: ${(e as Error).message}`);
  }

  if (!existing || !existing.profiles) {
    return generated;
  }

  const merged: Record<string, ProfileEntry> = { ...existing.profiles };

  for (const [name, profile] of Object.entries(generated.profiles)) {
    const isManaged = name === 'plan' || name === 'execute';
    if (!merged[name]) {
      merged[name] = profile;
      log.info(`Added new profile: ${name}`);
    } else if (isManaged && overwrite) {
      merged[name] = profile;
      log.info(`Overwrote managed profile: ${name}`);
    }
    // else: preserve existing
  }

  // Keep existing defaultProfile if it still exists in merged profiles
  let defaultProfile = existing.defaultProfile;
  if (!merged[defaultProfile]) {
    defaultProfile = generated.defaultProfile;
  }

  return { defaultProfile, profiles: merged };
}

export interface WriteProfilesOpts extends GenerateOpts {
  /** Output directory. Defaults to ~/.cortex/config. */
  outputDir?: string;
  /** Force overwrite of existing `plan` / `execute` profiles. Default false. */
  overwrite?: boolean;
}

/**
 * Write profiles.json to ~/.cortex/config/profiles.json (or outputDir/profiles.json).
 * Merges with existing file to preserve user customizations unless overwrite=true.
 */
export function writeProfilesJson(
  endpoints: DiscoveredEndpoint[],
  optsOrOutputDir?: WriteProfilesOpts | string,
): string {
  // Back-compat: previous signature was (endpoints, outputDir?: string)
  const opts: WriteProfilesOpts = typeof optsOrOutputDir === 'string'
    ? { outputDir: optsOrOutputDir }
    : (optsOrOutputDir ?? {});

  const generated = generateProfiles(endpoints, {
    planChoice: opts.planChoice,
    executeChoice: opts.executeChoice,
  });
  const merged = mergeProfilesJson(generated, opts.outputDir, opts.overwrite ?? false);

  const configDir = opts.outputDir || path.join(os.homedir(), '.cortex', 'config');
  const outputPath = path.join(configDir, 'profiles.json');

  mkdirSync(configDir, { recursive: true });

  const content = JSON.stringify(merged, null, 2) + '\n';
  writeFileSync(outputPath, content, 'utf-8');
  log.info(`Written profiles.json to ${outputPath}`);

  return outputPath;
}
