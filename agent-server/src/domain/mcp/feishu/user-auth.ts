// input:  Feishu OAuth v2 endpoints (authen/v2/oauth/token), CONFIG_DIR, global fetch
// output: user_access_token acquisition (authorize URL + code exchange), refresh, on-disk store,
//         and getValidUserAccessToken() (auto-refresh with a clear error when re-login is needed)
// pos:    Powers FEISHU_AUTH_MODE=user — MCP doc tools act as the operator's Feishu account.
//         Messaging (platform/adapters/feishu.ts) is unaffected; it stays app/bot identity.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as path from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { CONFIG_DIR } from '@core/utils.js';

export type FeishuDomain = 'feishu' | 'lark';

/** Persisted user token bundle (epoch-ms expiries so freshness is a pure comparison). */
export interface UserToken {
  access_token: string;
  refresh_token: string;
  access_expires_at: number;
  refresh_expires_at: number;
  scope?: string;
  obtained_at: number;
}

/** Minimal fetch surface (injectable in tests). Mirrors the global fetch we actually use. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

/** Thrown when there is no usable user token and the operator must (re-)run `cortex feishu login`. */
export class FeishuUserTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeishuUserTokenError';
  }
}

export interface OAuthHosts {
  /** Host that serves the user-facing authorization (consent) page. */
  authorizeBase: string;
  /** Host that serves the OAuth token endpoint (code exchange + refresh). */
  tokenBase: string;
}

/**
 * OAuth hosts per Feishu/Lark deployment. Feishu hosts are from the official OAuth v2 docs;
 * the larksuite.com equivalents mirror the same path layout (not separately documented).
 */
export function hostsFor(domain?: FeishuDomain): OAuthHosts {
  return domain === 'lark'
    ? { authorizeBase: 'https://accounts.larksuite.com', tokenBase: 'https://open.larksuite.com' }
    : { authorizeBase: 'https://accounts.feishu.cn', tokenBase: 'https://open.feishu.cn' };
}

const TOKEN_PATH = '/open-apis/authen/v2/oauth/token';
const AUTHORIZE_PATH = '/open-apis/authen/v1/authorize';

/** offline_access is required for the token endpoint to return a refresh_token. */
const REQUIRED_SCOPE = 'offline_access';

/** Default location of the on-disk token store (alongside .env in CONFIG_DIR). */
export function userTokenPath(): string {
  return path.join(CONFIG_DIR, 'feishu-user-token.json');
}

/** Merge caller scope(s) with the mandatory offline_access scope, de-duplicated. */
function normalizeScope(scope?: string): string {
  const parts = new Set((scope ?? '').split(/\s+/).filter(Boolean));
  parts.add(REQUIRED_SCOPE);
  return [...parts].join(' ');
}

/** Build the OAuth authorization URL the operator opens in a browser to grant access. */
export function buildAuthorizeUrl(opts: {
  appId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  domain?: FeishuDomain;
}): string {
  const { authorizeBase } = hostsFor(opts.domain);
  const url = new URL(authorizeBase + AUTHORIZE_PATH);
  url.searchParams.set('client_id', opts.appId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', normalizeScope(opts.scope));
  if (opts.state) url.searchParams.set('state', opts.state);
  return url.toString();
}

/** Accept either a bare authorization code or a full callback URL; return the code or null. */
export function parseCodeFromInput(input: string): string | null {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).searchParams.get('code');
    } catch {
      return null;
    }
  }
  return trimmed;
}

/** Map a raw OAuth token response into a persisted UserToken (computing absolute expiries). */
function toUserToken(data: any, now: number, prevRefresh?: string): UserToken {
  const accessTtl = Number(data.expires_in ?? 0) * 1000;
  const refreshTtl = Number(data.refresh_token_expires_in ?? 0) * 1000;
  return {
    access_token: String(data.access_token ?? ''),
    // refresh_token may be omitted on refresh responses; keep the previous one if so.
    refresh_token: String(data.refresh_token ?? prevRefresh ?? ''),
    access_expires_at: now + accessTtl,
    refresh_expires_at: now + refreshTtl,
    scope: data.scope,
    obtained_at: now,
  };
}

/** POST the OAuth token endpoint and surface API-level errors (code != 0 / error field). */
async function postToken(
  hosts: OAuthHosts,
  body: Record<string, string>,
  fetchImpl: FetchLike,
): Promise<any> {
  const res = await fetchImpl(hosts.tokenBase + TOKEN_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (typeof data.code === 'number' && data.code !== 0) || data.error) {
    const msg = data.error_description || data.error || data.msg || `HTTP ${res.status}`;
    const code = data.code ?? data.error ?? res.status;
    throw new Error(`Feishu OAuth error ${code}: ${msg}`);
  }
  return data;
}

/** Exchange an authorization code for a user_access_token + refresh_token. */
export async function exchangeCode(opts: {
  appId: string;
  appSecret: string;
  code: string;
  redirectUri?: string;
  domain?: FeishuDomain;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<UserToken> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const now = (opts.now ?? Date.now)();
  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    client_id: opts.appId,
    client_secret: opts.appSecret,
    code: opts.code,
  };
  if (opts.redirectUri) body.redirect_uri = opts.redirectUri;
  const data = await postToken(hostsFor(opts.domain), body, fetchImpl);
  return toUserToken(data, now);
}

/** Refresh a user_access_token using the (rotating) refresh_token. */
export async function refreshUserToken(opts: {
  appId: string;
  appSecret: string;
  refreshToken: string;
  domain?: FeishuDomain;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<UserToken> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const now = (opts.now ?? Date.now)();
  const data = await postToken(hostsFor(opts.domain), {
    grant_type: 'refresh_token',
    client_id: opts.appId,
    client_secret: opts.appSecret,
    refresh_token: opts.refreshToken,
  }, fetchImpl);
  return toUserToken(data, now, opts.refreshToken);
}

// ── On-disk token store ──────────────────────────────────────────

export function saveUserToken(tok: UserToken, file: string = userTokenPath()): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(tok, null, 2), { mode: 0o600 });
}

export function loadUserToken(file: string = userTokenPath()): UserToken | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as UserToken;
  } catch {
    return null;
  }
}

export function clearUserToken(file: string = userTokenPath()): boolean {
  if (!existsSync(file)) return false;
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

// ── High-level: a valid access token, auto-refreshed ─────────────

const RELOGIN = 'Run `cortex feishu login` to authorize a Feishu user account.';

/**
 * Return a valid user_access_token, refreshing (and persisting) it when near expiry.
 * Throws FeishuUserTokenError — never falls back to bot identity — when no token exists
 * or the refresh_token itself has expired.
 */
export async function getValidUserAccessToken(opts: {
  appId: string;
  appSecret: string;
  domain?: FeishuDomain;
  file?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  bufferMs?: number;
}): Promise<string> {
  const file = opts.file ?? userTokenPath();
  const now = (opts.now ?? Date.now)();
  const buffer = opts.bufferMs ?? 120_000; // refresh 2 min early

  const tok = loadUserToken(file);
  if (!tok || !tok.access_token) {
    throw new FeishuUserTokenError(`No Feishu user token found. ${RELOGIN}`);
  }
  if (now < tok.access_expires_at - buffer) {
    return tok.access_token;
  }
  if (!tok.refresh_token || now >= tok.refresh_expires_at) {
    throw new FeishuUserTokenError(`Feishu user token expired and cannot be refreshed. ${RELOGIN}`);
  }
  const refreshed = await refreshUserToken({
    appId: opts.appId,
    appSecret: opts.appSecret,
    refreshToken: tok.refresh_token,
    domain: opts.domain,
    fetchImpl: opts.fetchImpl,
    now: () => now,
  });
  saveUserToken(refreshed, file);
  return refreshed.access_token;
}
