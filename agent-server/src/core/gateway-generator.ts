// input:  fs, path, os, Claude credentials.json, PI models.json / auth.json
// output: generateGatewayYaml() — scans Claude/PI local config, produces gateway.yaml content
// pos:    init-time gateway config auto-generation

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from './log.js';

const log = createLogger('gateway-generator');

// ─── Types ────────────────────────────────────────────────────────

export interface DiscoveredEndpoint {
  /** Mode key in gateway.yaml (e.g. "api", "plan", "deepseek-anthropic") */
  mode: string;
  /** Endpoint name (e.g. "anthropic", "openai") */
  endpoint: string;
  base_url: string;
  auth_style: string;
  keys: string[];
  passthrough: boolean;
  /** Model IDs known to be available for this endpoint */
  models: string[];
  /** Tier-based model fallback chain for model_fallbacks */
  modelFallbacks: Record<string, string[]>;
}

export interface GatewayGenInput {
  /** Discovered endpoints from Claude Code and PI configs */
  endpoints: DiscoveredEndpoint[];
  /** Default active mode */
  defaultMode?: string;
}

// ─── Paths ─────────────────────────────────────────────────────────

const CLAUDE_CREDENTIALS = path.join(os.homedir(), '.claude', '.credentials.json');
const PI_MODELS = path.join(os.homedir(), '.pi', 'agent', 'models.json');
const PI_AUTH = path.join(os.homedir(), '.pi', 'agent', 'auth.json');
const PI_SETTINGS = path.join(os.homedir(), '.pi', 'agent', 'settings.json');

// ─── Anthropic model tiers (by subscription type) ─────────────────

/** Model names used in gateway model_fallbacks (API-level model IDs). */
const ANTHROPIC_MODEL_TIERS: Record<string, string[]> = {
  max: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  pro: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
  free: ['claude-haiku-4-5'],
};

/** Generate model_fallbacks: each model falls back to all lower-tier models. */
function buildModelFallbacks(models: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (let i = 0; i < models.length; i++) {
    const fallbacks = models.slice(i + 1);
    if (fallbacks.length > 0) {
      result[models[i]] = fallbacks;
    }
  }
  return result;
}

// ─── Known provider defaults (used when PI auth.json has a key but no models.json) ──

interface ProviderDefaults {
  base_url: string;
  auth_style: string;
  models: string[];
}

const KNOWN_PROVIDERS: Record<string, ProviderDefaults> = {
  deepseek: {
    base_url: 'https://api.deepseek.com/anthropic',
    auth_style: 'anthropic',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  openai: {
    base_url: 'https://api.openai.com',
    auth_style: 'openai',
    models: ['gpt-5.4', 'gpt-5.4-mini'],
  },
  google: {
    base_url: 'https://generativelanguage.googleapis.com',
    auth_style: 'google',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
};

// ─── Scanning ──────────────────────────────────────────────────────

interface ClaudeCreds {
  subscriptionType?: string;
  accessToken?: string;
}

/** Read and parse Claude Code credentials. Returns null if not logged in. */
function scanClaudeCode(): ClaudeCreds | null {
  try {
    if (!existsSync(CLAUDE_CREDENTIALS)) {
      log.info('Claude Code credentials not found — user may not be logged in');
      return null;
    }
    const raw = JSON.parse(readFileSync(CLAUDE_CREDENTIALS, 'utf-8'));
    const oauth = raw?.claudeAiOauth;
    if (!oauth?.accessToken) {
      log.info('Claude Code credentials exist but no OAuth token found');
      return null;
    }
    return {
      subscriptionType: oauth.subscriptionType || 'free',
      accessToken: oauth.accessToken,
    };
  } catch (e) {
    log.warn(`Failed to read Claude Code credentials: ${(e as Error).message}`);
    return null;
  }
}

interface PiProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  api: string;       // e.g. "anthropic-messages", "openai"
  models: string[];
}

interface PiAuth {
  name: string;
  key: string;
}

/** Read and parse PI models.json + auth.json. Returns discovered providers. */
function scanPI(): PiProvider[] {
  const providers: PiProvider[] = [];

  // Parse models.json for configured providers
  let modelsConfig: Record<string, any> = {};
  try {
    if (existsSync(PI_MODELS)) {
      modelsConfig = JSON.parse(readFileSync(PI_MODELS, 'utf-8'));
    }
  } catch (e) {
    log.warn(`Failed to read PI models.json: ${(e as Error).message}`);
  }

  // Parse auth.json for API keys
  let authConfig: Record<string, PiAuth> = {};
  try {
    if (existsSync(PI_AUTH)) {
      const raw = JSON.parse(readFileSync(PI_AUTH, 'utf-8'));
      for (const [name, entry] of Object.entries(raw)) {
        const e = entry as any;
        if (e?.key) {
          authConfig[name] = { name, key: e.key };
        }
      }
    }
  } catch (e) {
    log.warn(`Failed to read PI auth.json: ${(e as Error).message}`);
  }

  // Merge models.json providers
  const modelsProviders = modelsConfig?.providers || {};
  for (const [name, p] of Object.entries(modelsProviders)) {
    const prov = p as any;
    const models = (prov.models || []).map((m: any) => m.id || m);
    providers.push({
      name,
      baseUrl: prov.baseUrl || '',
      apiKey: prov.apiKey || authConfig[name]?.key || '',
      api: prov.api || 'anthropic-messages',
      models,
    });
  }

  // Add providers from auth.json that aren't in models.json yet
  for (const [name, auth] of Object.entries(authConfig)) {
    if (providers.some(p => p.name === name)) continue;
    const known = KNOWN_PROVIDERS[name];
    if (!known) {
      log.info(`PI auth key found for unknown provider "${name}" — skipping`);
      continue;
    }
    providers.push({
      name,
      baseUrl: known.base_url,
      apiKey: auth.key,
      api: known.auth_style === 'anthropic' ? 'anthropic-messages' : known.auth_style,
      models: known.models,
    });
  }

  return providers;
}

// ─── Discovery ─────────────────────────────────────────────────────

/**
 * Determine the auth_style and api type from PI provider config.
 * PI's `api` field: "anthropic-messages" → auth_style "anthropic", "openai" → "openai"
 */
function piApiToAuthStyle(api: string): { auth_style: string; endpoint: string } {
  switch (api) {
    case 'anthropic-messages': return { auth_style: 'anthropic', endpoint: 'anthropic' };
    case 'openai': return { auth_style: 'openai', endpoint: 'openai' };
    default: return { auth_style: 'bearer', endpoint: api };
  }
}

/** Check if a URL is a gateway URL (localhost:9880 or 127.0.0.1:9880). */
function isGatewayUrl(url: string): boolean {
  return url.includes('127.0.0.1:9880') || url.includes('localhost:9880');
}

/**
 * Scan Claude Code and PI configurations and return discovered endpoints.
 *
 * Rules:
 * - Claude Code plan mode: always generated (OAuth bearer passthrough, no managed keys).
 * - Claude Code api mode: generated only if ANTHROPIC_API_KEY env var is set (referenced via $ANTHROPIC_API_KEY).
 * - PI providers from auth.json: use known provider defaults.
 * - PI providers from models.json: skip if base URL is already a gateway URL (already configured).
 */
export function discoverEndpoints(): DiscoveredEndpoint[] {
  const endpoints: DiscoveredEndpoint[] = [];

  // ── Claude Code → Anthropic plan mode ──
  const claude = scanClaudeCode();
  if (claude) {
    const models = ANTHROPIC_MODEL_TIERS[claude.subscriptionType || 'free'] || ANTHROPIC_MODEL_TIERS.free;

    // plan mode — OAuth bearer passthrough (no managed keys needed)
    endpoints.push({
      mode: 'plan',
      endpoint: 'anthropic',
      base_url: 'https://api.anthropic.com',
      auth_style: 'bearer',
      keys: [],
      passthrough: true,
      models,
      modelFallbacks: {},
    });

    // api mode — only if ANTHROPIC_API_KEY is set (referenced via env var, not raw token)
    if (process.env.ANTHROPIC_API_KEY) {
      endpoints.push({
        mode: 'api',
        endpoint: 'anthropic',
        base_url: 'https://api.anthropic.com',
        auth_style: 'anthropic',
        keys: ['$ANTHROPIC_API_KEY'],
        passthrough: true,
        models,
        modelFallbacks: buildModelFallbacks(models),
      });
    }
  }

  // ── PI → per-provider endpoints ──
  const piProviders = scanPI();
  for (const prov of piProviders) {
    // Skip providers whose base URL is already a gateway URL (already configured)
    if (isGatewayUrl(prov.baseUrl)) {
      log.info(`PI provider "${prov.name}" already routes through gateway — skipping`);
      continue;
    }

    const { auth_style, endpoint } = piApiToAuthStyle(prov.api);
    const modeName = prov.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

    // Use env var reference for keys when possible, fall back to raw key from PI auth
    let keys: string[] = [];
    if (prov.apiKey) {
      // Check if this key matches a known env var to use reference
      const envRef = findEnvVarRef(prov.name, prov.apiKey);
      keys = envRef ? [envRef] : [prov.apiKey];
    }

    endpoints.push({
      mode: modeName,
      endpoint,
      base_url: prov.baseUrl,
      auth_style,
      keys,
      passthrough: false,
      models: prov.models,
      modelFallbacks: {},
    });
  }

  return endpoints;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Try to match a raw API key to a known environment variable. */
function findEnvVarRef(providerName: string, apiKey: string): string | null {
  const envMap: Record<string, string> = {
    deepseek: 'DEEPSEEK_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
  };

  const envVar = envMap[providerName];
  if (envVar && process.env[envVar] && process.env[envVar] === apiKey) {
    return `$${envVar}`;
  }
  return null;
}

// ─── YAML Generation ───────────────────────────────────────────────

interface GatewayYamlTop {
  port: number;
  mode: string;
  status_check: boolean;
  [key: string]: any;  // endpoint sections
}

/**
 * Generate gateway.yaml content from discovered endpoints.
 * Outputs a formatted YAML string with comments explaining each mode.
 */
export function generateGatewayYaml(endpoints: DiscoveredEndpoint[], defaultMode?: string): string {
  // Group endpoints by endpoint name (e.g., "anthropic", "openai")
  const byEndpoint: Record<string, DiscoveredEndpoint[]> = {};
  for (const ep of endpoints) {
    (byEndpoint[ep.endpoint] ||= []).push(ep);
  }

  const lines: string[] = [];
  lines.push('# aistatus gateway — auto-generated by cortex init');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('#');
  lines.push('# Per-mode routing: each mode maps to an endpoint + auth config.');
  lines.push('# Managed keys are used first (with round-robin on 429/5xx),');
  lines.push('# then passthrough of the caller\'s own key when passthrough: true.');
  lines.push('#');
  lines.push('# Docs: https://aistatus.cc/docs');
  lines.push('');

  // Determine default mode
  const activeMode = defaultMode || endpoints[0]?.mode || 'api';

  // Collect all modes for the comment
  const allModes = endpoints.map(e => e.mode).filter((v, i, a) => a.indexOf(v) === i);
  lines.push(`port: 9880`);
  lines.push(`mode: ${activeMode}  # active billing mode: ${allModes.join(' | ')}`);
  lines.push(`status_check: true`);

  for (const [epName, eps] of Object.entries(byEndpoint)) {
    lines.push('');
    lines.push(`${epName}:`);
    for (const ep of eps) {
      // Determine provider label for the comment
      const providerLabel = ep.mode === 'plan' ? 'Anthropic Claude (OAuth passthrough, billed via subscription)' :
        ep.mode === 'api' ? 'Anthropic Claude (API key, billed via API credits)' :
        `${capitalize(ep.mode)} (${ep.endpoint}-compatible API)`;
      lines.push(`  # ── ${providerLabel} ──`);
      lines.push(`  ${ep.mode}:`);
      lines.push(`    base_url: ${ep.base_url}`);
      lines.push(`    auth_style: ${ep.auth_style}`);

      if (ep.keys.length > 0) {
        lines.push(`    keys:`);
        for (const key of ep.keys) {
          lines.push(`      - ${key}`);
        }
      }
      if (ep.keys.length === 0) {
        lines.push(`    # No managed keys — ${ep.passthrough ? 'caller key passthrough' : 'waiting for key configuration'}`);
      }
      if (ep.passthrough && ep.keys.length > 0) {
        lines.push(`    passthrough: true`);
      }
      if (Object.keys(ep.modelFallbacks).length > 0) {
        lines.push(`    model_fallbacks:`);
        for (const [model, fallbacks] of Object.entries(ep.modelFallbacks)) {
          lines.push(`      ${model}:`);
          for (const fb of fallbacks) {
            lines.push(`        - ${fb}`);
          }
        }
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Write gateway.yaml to the specified path or ~/.aistatus/gateway.yaml.
 * If file already exists and outputDir is not specified, backs it up as gateway.yaml.bak before overwriting.
 * When outputDir is provided, writes to <outputDir>/gateway.yaml without backup.
 */
export function writeGatewayYaml(yamlContent: string, outputDir?: string): string {
  const configDir = outputDir || path.join(os.homedir(), '.aistatus');
  const configPath = path.join(configDir, 'gateway.yaml');

  // Backup existing file (only for default path)
  if (!outputDir && existsSync(configPath)) {
    const backupPath = configPath + '.bak';
    try {
      copyFileSync(configPath, backupPath);
      log.info(`Backed up existing gateway.yaml to ${backupPath}`);
    } catch (e) {
      log.warn(`Failed to backup existing gateway.yaml: ${(e as Error).message}`);
    }
  }

  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, yamlContent, 'utf-8');
  log.info(`Written gateway.yaml to ${configPath}`);

  return configPath;
}

/**
 * Run discovery and return the YAML string (without writing to disk).
 * Useful for dry-run / preview.
 */
export function dryRunGatewayYaml(): string {
  const endpoints = discoverEndpoints();
  if (endpoints.length === 0) {
    return '# No backends discovered. Log into Claude Code and/or PI first.\n';
  }
  return generateGatewayYaml(endpoints);
}
