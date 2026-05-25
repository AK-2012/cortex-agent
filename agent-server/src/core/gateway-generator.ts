// input:  fs, path, os, `pi --list-models` output
// output: discoverEndpoints / generateGatewayYaml / writeGatewayYaml / parsePiListModelsOutput
//         — spawns pi --list-models, produces gateway.yaml content
// pos:    init-time gateway config auto-generation. PI model metadata is owned by the PI agent
//         (we shell out to `pi --list-models` rather than maintain provider/model whitelists).
//         Claude plan mode is always assumed (user must have claude login), no credential scanning.

import { writeFileSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from './log.js';

const log = createLogger('gateway-generator');

// ─── Types ────────────────────────────────────────────────────────

export interface DiscoveredEndpoint {
  /** Mode key in gateway.yaml + cortex profile (e.g. "plan", "deepseek", "openai-codex") */
  mode: string;
  /** Endpoint group name (e.g. "anthropic", "deepseek", "openai-codex") */
  endpoint: string;
  base_url: string;
  auth_style: string;
  keys: string[];
  passthrough: boolean;
  /** Model IDs known to be available for this endpoint */
  models: string[];
  /** Whether gateway.yaml should render an endpoint section for this entry. PI providers without a
   *  known upstream URL are surfaced as profiles but skipped in gateway.yaml. */
  gatewayManaged: boolean;
}

// ─── Anthropic models (default tier) ─────────────────────────────

const ANTHROPIC_MODELS = ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'];

// ─── PI provider → upstream URL lookup (manually maintained) ────────────────

/**
 * Map a PI built-in provider name to its real upstream URL. Used by `generateGatewayYaml` so PI
 * traffic can be routed through the gateway. Entries are sourced from PI source / docs.
 *
 * Providers absent from this table are still surfaced as cortex profiles, but no gateway endpoint
 * is generated for them (gatewayManaged=false). PI will then either fail (if the cortex spawn path
 * forces gateway routing) or direct-call the upstream (if the spawn path leaves models.json
 * untouched for that provider). See `/home/fangxin/.cortex/plan/generic-wibbling-pine.md` stage E
 * for the eventual full plumbing.
 */
const PI_PROVIDER_UPSTREAM: Record<string, { url: string; auth_style: string }> = {
  // Anthropic-protocol providers (PI's `api: anthropic-messages`)
  anthropic: { url: 'https://api.anthropic.com', auth_style: 'bearer' },
  fireworks: { url: 'https://api.fireworks.ai/inference', auth_style: 'bearer' },
  'github-copilot': { url: 'https://api.individual.githubcopilot.com', auth_style: 'bearer' },
  'kimi-coding': { url: 'https://api.kimi.com/coding', auth_style: 'bearer' },
  minimax: { url: 'https://api.minimax.io/anthropic', auth_style: 'bearer' },
  'minimax-cn': { url: 'https://api.minimaxi.com/anthropic', auth_style: 'bearer' },
  opencode: { url: 'https://opencode.ai/zen', auth_style: 'bearer' },
  'vercel-ai-gateway': { url: 'https://ai-gateway.vercel.sh', auth_style: 'bearer' },

  // OpenAI-completions / OpenAI-responses providers
  cerebras: { url: 'https://api.cerebras.ai/v1', auth_style: 'bearer' },
  deepseek: { url: 'https://api.deepseek.com', auth_style: 'bearer' },
  groq: { url: 'https://api.groq.com/openai/v1', auth_style: 'bearer' },
  huggingface: { url: 'https://router.huggingface.co/v1', auth_style: 'bearer' },
  mistral: { url: 'https://api.mistral.ai', auth_style: 'bearer' },
  openai: { url: 'https://api.openai.com/v1', auth_style: 'bearer' },
  'opencode-go': { url: 'https://opencode.ai/zen/go/v1', auth_style: 'bearer' },
  openrouter: { url: 'https://openrouter.ai/api/v1', auth_style: 'bearer' },
  xai: { url: 'https://api.x.ai/v1', auth_style: 'bearer' },
  zai: { url: 'https://api.z.ai/api/coding/paas/v4', auth_style: 'bearer' },

  // OAuth subscription providers (PI manages OAuth refresh; gateway transparently passthrough)
  'openai-codex': { url: 'https://chatgpt.com/backend-api', auth_style: 'bearer' },
  'google-gemini-cli': { url: 'https://cloudcode-pa.googleapis.com', auth_style: 'bearer' },
  'google-antigravity': { url: 'https://daily-cloudcode-pa.sandbox.googleapis.com', auth_style: 'bearer' },

  // Other built-ins
  google: { url: 'https://generativelanguage.googleapis.com/v1beta', auth_style: 'bearer' },
  // amazon-bedrock / google-vertex / azure-openai-responses / cloudflare-workers-ai use
  // env-driven URLs (region / account ID / resource name) — not safely templated here.
  // Users wanting these through the gateway must edit gateway.yaml manually.
};

// ─── Scanning: PI via `pi --list-models` ──────────────────────────

export interface PiDiscoveredModel {
  provider: string;
  model: string;
}

/**
 * Parse the table output of `pi --list-models` into structured entries.
 * Skips header row, blank lines, and the "No models available" fallback message.
 *
 * Example input:
 *   provider   model                       context  max-out  thinking  images
 *   anthropic  claude-3-5-haiku-20241022   200K     8.2K     no        yes
 *   deepseek   deepseek-v4-pro             1M       384K     yes       no
 */
export function parsePiListModelsOutput(stdout: string): PiDiscoveredModel[] {
  const lines = stdout.split('\n');
  const result: PiDiscoveredModel[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('No models available')) return [];
    // PI uses 2+ spaces between columns for alignment
    const parts = line.split(/\s{2,}/);
    if (parts.length < 2) continue;
    const [provider, model] = parts;
    if (provider === 'provider' && model === 'model') continue; // header row
    result.push({ provider, model });
  }
  return result;
}

/**
 * Discover PI providers and models by shelling out to `pi --list-models`.
 * PI is the authoritative source of model metadata — cortex does not maintain a whitelist.
 *
 * Returns an empty array on any failure (PI not installed, timeout, parse error). The init flow
 * should warn the user and tell them to `pi /login` first.
 */
function scanPIViaListModels(): PiDiscoveredModel[] {
  try {
    // PI writes the table to stderr (not stdout) — merge via `2>&1` so we can parse it.
    // Intentionally do NOT set PI_CODING_AGENT_DIR: discovery reads the user's real ~/.pi/agent/.
    const stdout = execSync('pi --list-models 2>&1', {
      timeout: 10_000,
      encoding: 'utf-8',
    });
    return parsePiListModelsOutput(stdout);
  } catch (e) {
    const err = e as { code?: string; status?: number; message?: string };
    if (err.code === 'ENOENT') {
      log.info('PI is not installed — skipping PI provider discovery');
    } else {
      log.info(`pi --list-models failed (code=${err.code ?? err.status}): ${err.message ?? 'unknown error'}`);
    }
    return [];
  }
}

// ─── Discovery ─────────────────────────────────────────────────────

/**
 * Scan Claude Code and PI configurations and return discovered endpoints.
 *
 * - Claude Code plan mode: always generated if logged in (OAuth bearer passthrough).
 * - Claude Code api mode: generated only if ANTHROPIC_API_KEY env var is set.
 * - PI providers: discovered via `pi --list-models`. Each provider becomes one endpoint with
 *   `mode = endpoint = provider name`. `gatewayManaged` is true only if the provider has a known
 *   upstream URL in PI_PROVIDER_UPSTREAM (otherwise profile is generated but gateway.yaml entry
 *   is skipped).
 */
export function discoverEndpoints(): DiscoveredEndpoint[] {
  const endpoints: DiscoveredEndpoint[] = [];

  // ── Claude Code → Anthropic plan mode (always on) ──
  endpoints.push({
    mode: 'plan',
    endpoint: 'anthropic',
    base_url: 'https://api.anthropic.com',
    auth_style: 'bearer',
    keys: [],
    passthrough: true,
    models: ANTHROPIC_MODELS,
    gatewayManaged: true,
  });

  // api mode — only if ANTHROPIC_API_KEY is set
  if (process.env.ANTHROPIC_API_KEY) {
    endpoints.push({
      mode: 'api',
      endpoint: 'anthropic',
      base_url: 'https://api.anthropic.com',
      auth_style: 'anthropic',
      keys: ['$ANTHROPIC_API_KEY'],
      passthrough: true,
      models: ANTHROPIC_MODELS,
      gatewayManaged: true,
    });
  }

  // ── PI → per-provider endpoints (one mode per provider) ──
  const piModels = scanPIViaListModels();
  // Group models by provider name
  const byProvider = new Map<string, string[]>();
  for (const { provider, model } of piModels) {
    if (!byProvider.has(provider)) byProvider.set(provider, []);
    byProvider.get(provider)!.push(model);
  }

  for (const [provider, models] of byProvider) {
    const upstream = PI_PROVIDER_UPSTREAM[provider];
    // anthropic is already covered by the Claude Code path above (with the user's OAuth subscription
    // tier). If PI also reports anthropic, skip — Claude path is authoritative for plan mode.
    if (provider === 'anthropic') continue;

    endpoints.push({
      mode: provider,
      endpoint: provider,
      base_url: upstream?.url ?? '',
      auth_style: upstream?.auth_style ?? 'bearer',
      keys: [],
      passthrough: true,
      models,
      gatewayManaged: !!upstream,
    });
  }

  return endpoints;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── YAML Generation ───────────────────────────────────────────────

/**
 * Generate gateway.yaml content from discovered endpoints.
 * Outputs a formatted YAML string with comments explaining each mode.
 *
 * Endpoints with gatewayManaged=false are skipped (their profile still exists in profiles.json,
 * but gateway.yaml has no entry for them — PI traffic to those providers is currently direct).
 */
export function generateGatewayYaml(endpoints: DiscoveredEndpoint[], defaultMode?: string): string {
  const renderable = endpoints.filter(e => e.gatewayManaged !== false);

  // Group renderable endpoints by endpoint name (e.g., "anthropic", "deepseek")
  const byEndpoint: Record<string, DiscoveredEndpoint[]> = {};
  for (const ep of renderable) {
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

  // Determine default mode (first renderable endpoint, falling back to all endpoints)
  const activeMode = defaultMode || renderable[0]?.mode || endpoints[0]?.mode || 'api';

  // Collect all renderable modes for the comment
  const allModes = renderable.map(e => e.mode).filter((v, i, a) => a.indexOf(v) === i);
  lines.push(`port: 9880`);
  lines.push(`mode: ${activeMode}${allModes.length > 0 ? `  # active billing mode: ${allModes.join(' | ')}` : ''}`);
  lines.push(`status_check: true`);

  for (const [epName, eps] of Object.entries(byEndpoint)) {
    lines.push('');
    lines.push(`${epName}:`);
    for (const ep of eps) {
      // Determine provider label for the comment
      const providerLabel = ep.mode === 'plan' ? 'Anthropic Claude (OAuth passthrough, billed via subscription)' :
        ep.mode === 'api' ? 'Anthropic Claude (API key, billed via API credits)' :
        `${capitalize(ep.mode)} (PI-managed auth, routed through gateway)`;
      lines.push(`  # ── ${providerLabel} ──`);
      lines.push(`  ${ep.mode}:`);
      lines.push(`    base_url: ${ep.base_url}`);
      lines.push(`    auth_style: ${ep.auth_style}`);

      if (ep.keys.length > 0) {
        lines.push(`    keys:`);
        for (const key of ep.keys) {
          lines.push(`      - ${key}`);
        }
      } else {
        lines.push(`    # No managed keys — ${ep.passthrough ? 'caller key passthrough' : 'waiting for key configuration'}`);
      }
      if (ep.passthrough && ep.keys.length > 0) {
        lines.push(`    passthrough: true`);
      }
    }
  }

  // Footer: list any PI providers we discovered but couldn't route (gatewayManaged=false)
  const skipped = endpoints.filter(e => e.gatewayManaged === false);
  if (skipped.length > 0) {
    lines.push('');
    lines.push('# Skipped (no known upstream URL in PI_PROVIDER_UPSTREAM):');
    for (const s of skipped) {
      lines.push(`#   ${s.mode} (${s.models.length} model${s.models.length === 1 ? '' : 's'})`);
    }
    lines.push('# These providers appear in profiles.json but are not routed through this gateway.');
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
