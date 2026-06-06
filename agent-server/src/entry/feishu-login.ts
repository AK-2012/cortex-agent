// input:  readline, dotenv, @core/utils (CONFIG_DIR), feishu/user-auth
// output: cmdFeishu() — `cortex feishu login | status | logout` (user_access_token lifecycle)
// pos:    CLI for FEISHU_AUTH_MODE=user. login runs the OAuth browser flow (paste code or
//         callback URL); status/logout inspect/clear the on-disk token. Dispatched from cli.ts.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as readline from 'readline';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { CONFIG_DIR } from '@core/utils.js';
import {
  buildAuthorizeUrl,
  parseCodeFromInput,
  exchangeCode,
  saveUserToken,
  loadUserToken,
  clearUserToken,
  userTokenPath,
  type FeishuDomain,
  type FetchLike,
} from '@domain/mcp/feishu/user-auth.js';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Injectable seams so the dispatcher is testable without real stdin/network/CONFIG_DIR. */
export interface FeishuCliDeps {
  env?: NodeJS.ProcessEnv;
  prompt?: (question: string) => Promise<string>;
  now?: () => number;
  tokenFile?: string;
  fetchImpl?: FetchLike;
  /** When true (default), merge CONFIG_DIR/.env into env so credentials are available. */
  loadDotenv?: boolean;
}

export function getFeishuHelp(): string {
  return [
    'Manage Feishu user-identity login (FEISHU_AUTH_MODE=user)',
    '',
    'Usage: cortex feishu <login|status|logout> [options]',
    '',
    '  login    Authorize a Feishu user account via OAuth (paste the code or callback URL)',
    '  status   Show the current auth mode and stored user-token state',
    '  logout   Delete the stored user token',
    '',
    'Options:',
    '  --redirect-uri <url>   OAuth redirect URI (default: $FEISHU_REDIRECT_URI)',
    '  --scope <scopes>       Space-separated extra scopes (offline_access is always added)',
    '  --help, -h             Show this help',
  ].join('\n');
}

/** Default readline-based prompt (one line of stdin). */
function readlinePrompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
}

function fmtExpiry(ms: number): string {
  if (!ms) return 'unknown';
  return new Date(ms).toISOString();
}

export async function cmdFeishu(args: string[], deps: FeishuCliDeps = {}): Promise<CliResult> {
  const sub = args[0];
  if (!sub || sub === '--help' || sub === '-h') {
    return { exitCode: sub ? 0 : 1, stdout: getFeishuHelp(), stderr: '' };
  }

  const env: NodeJS.ProcessEnv = deps.env ?? process.env;
  if (deps.loadDotenv !== false && !deps.env) {
    dotenv.config({ path: path.join(CONFIG_DIR, '.env') });
  }
  const tokenFile = deps.tokenFile ?? userTokenPath();
  const domain = (env.FEISHU_DOMAIN as FeishuDomain) || undefined;

  switch (sub) {
    case 'login': {
      const appId = env.FEISHU_APP_ID;
      const appSecret = env.FEISHU_APP_SECRET;
      if (!appId || !appSecret) {
        return { exitCode: 1, stdout: '', stderr: 'Missing FEISHU_APP_ID / FEISHU_APP_SECRET. Run `cortex init` or set them in the .env first.\n' };
      }
      const redirectUri = flag(args, '--redirect-uri') ?? env.FEISHU_REDIRECT_URI;
      if (!redirectUri) {
        return {
          exitCode: 1, stdout: '',
          stderr: 'No redirect URI. Set FEISHU_REDIRECT_URI (registered in the Feishu app console) or pass --redirect-uri.\n',
        };
      }
      const scope = flag(args, '--scope') ?? env.FEISHU_USER_SCOPE;
      const url = buildAuthorizeUrl({ appId, redirectUri, scope, state: 'cortex', domain });

      const out: string[] = [
        '1) Open this URL in a browser and authorize:',
        '',
        `   ${url}`,
        '',
        '2) After authorizing you will be redirected to your redirect URI.',
        '   Copy the authorization code (the `code` query param) — or the whole redirected URL.',
        '',
      ];
      process.stdout.write(out.join('\n'));

      const prompt = deps.prompt ?? readlinePrompt;
      const answer = await prompt('Paste the code or callback URL: ');
      const code = parseCodeFromInput(answer);
      if (!code) {
        return { exitCode: 1, stdout: '', stderr: 'Could not read an authorization code from the input.\n' };
      }
      try {
        const tok = await exchangeCode({ appId, appSecret, code, redirectUri, domain, fetchImpl: deps.fetchImpl, now: deps.now });
        saveUserToken(tok, tokenFile);
        return {
          exitCode: 0, stderr: '',
          stdout: [
            '',
            'Logged in as Feishu user.',
            `  scope:          ${tok.scope ?? '(default)'}`,
            `  access expires: ${fmtExpiry(tok.access_expires_at)}`,
            `  refresh expires:${fmtExpiry(tok.refresh_expires_at)}`,
            `  token file:     ${tokenFile}`,
            '',
            'Set FEISHU_AUTH_MODE=user in your .env and restart Cortex for doc tools to use this identity.',
            '',
          ].join('\n'),
        };
      } catch (e) {
        return { exitCode: 1, stdout: '', stderr: `Login failed: ${(e as Error).message}\n` };
      }
    }

    case 'status': {
      const mode = env.FEISHU_AUTH_MODE === 'user' ? 'user' : 'bot';
      const tok = loadUserToken(tokenFile);
      const lines = [`Feishu auth mode: ${mode}`, `Token file: ${tokenFile}`];
      if (!tok) {
        lines.push('User token: not logged in (no token stored).');
        if (mode === 'user') lines.push('Doc tools will fail until you run `cortex feishu login`.');
      } else {
        const now = (deps.now ?? Date.now)();
        const accessOk = now < tok.access_expires_at;
        const refreshOk = now < tok.refresh_expires_at;
        const state = accessOk ? 'valid' : refreshOk ? 'expired (refreshable)' : 'expired (re-login needed)';
        lines.push(
          `User token: logged in — ${state}`,
          `  scope:          ${tok.scope ?? '(default)'}`,
          `  access expires: ${fmtExpiry(tok.access_expires_at)}`,
          `  refresh expires:${fmtExpiry(tok.refresh_expires_at)}`,
        );
      }
      return { exitCode: 0, stdout: lines.join('\n') + '\n', stderr: '' };
    }

    case 'logout': {
      const removed = clearUserToken(tokenFile);
      return {
        exitCode: 0, stderr: '',
        stdout: removed ? `Removed stored Feishu user token (${tokenFile}).\n` : 'No stored Feishu user token to remove.\n',
      };
    }

    default:
      return { exitCode: 1, stdout: '', stderr: `Unknown subcommand '${sub}'.\n\n${getFeishuHelp()}\n` };
  }
}
