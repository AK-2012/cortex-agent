// input:  node:test, entry/feishu-login (cmdFeishu) with injected env/prompt/fetch/token-file
// output: TDD spec for `cortex feishu login|status|logout` dispatch + credential gating
// pos:    Verifies the login CLI without touching real stdin/network/CONFIG_DIR.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { cmdFeishu } from '../src/entry/feishu-login.js';
import { saveUserToken, loadUserToken, type FetchLike } from '../src/domain/mcp/feishu/user-auth.js';

function tmpFile(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), 'feishu-cli-')), 'feishu-user-token.json');
}

const creds = { FEISHU_APP_ID: 'id', FEISHU_APP_SECRET: 'sec', FEISHU_REDIRECT_URI: 'https://app/cb', FEISHU_DOMAIN: 'feishu' };

function okFetch(payload: any): FetchLike {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

test('login fails clearly when app credentials are missing', async () => {
  const res = await cmdFeishu(['login'], { env: {}, loadDotenv: false, tokenFile: tmpFile() });
  assert.equal(res.exitCode, 1);
  assert.match(res.stderr, /FEISHU_APP_ID/);
});

test('login fails when no redirect URI is configured', async () => {
  const res = await cmdFeishu(['login'], {
    env: { FEISHU_APP_ID: 'id', FEISHU_APP_SECRET: 'sec' }, loadDotenv: false, tokenFile: tmpFile(),
  });
  assert.equal(res.exitCode, 1);
  assert.match(res.stderr, /redirect/i);
});

test('login happy path exchanges the pasted code and persists the token', async () => {
  const file = tmpFile();
  const res = await cmdFeishu(['login'], {
    env: { ...creds }, loadDotenv: false, tokenFile: file,
    now: () => 1000,
    prompt: async () => 'https://app/cb?code=THECODE&state=x',
    fetchImpl: okFetch({ code: 0, access_token: 'AT', refresh_token: 'RT', expires_in: 7200, refresh_token_expires_in: 2592000, scope: 'offline_access docx:document' }),
  });
  assert.equal(res.exitCode, 0, res.stderr);
  assert.match(res.stdout, /docx:document/);
  assert.equal(loadUserToken(file)?.access_token, 'AT');
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('login rejects an unparseable code input', async () => {
  const res = await cmdFeishu(['login'], {
    env: { ...creds }, loadDotenv: false, tokenFile: tmpFile(),
    prompt: async () => '   ',
    fetchImpl: okFetch({}),
  });
  assert.equal(res.exitCode, 1);
  assert.match(res.stderr, /code/i);
});

test('status reports not-logged-in when no token exists', async () => {
  const res = await cmdFeishu(['status'], { env: { ...creds, FEISHU_AUTH_MODE: 'user' }, loadDotenv: false, tokenFile: tmpFile() });
  assert.equal(res.exitCode, 0);
  assert.match(res.stdout, /user/);
  assert.match(res.stdout, /not logged in|no .*token/i);
});

test('status shows token presence and mode when logged in', async () => {
  const file = tmpFile();
  saveUserToken({ access_token: 'AT', refresh_token: 'RT', access_expires_at: 5_000_000_000_000, refresh_expires_at: 6_000_000_000_000, scope: 'offline_access', obtained_at: 0 }, file);
  const res = await cmdFeishu(['status'], { env: { ...creds, FEISHU_AUTH_MODE: 'user' }, loadDotenv: false, tokenFile: file });
  assert.equal(res.exitCode, 0);
  assert.match(res.stdout, /logged in|active|valid/i);
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('logout removes the token file', async () => {
  const file = tmpFile();
  saveUserToken({ access_token: 'AT', refresh_token: 'RT', access_expires_at: 1, refresh_expires_at: 2, obtained_at: 0 }, file);
  assert.ok(existsSync(file));
  const res = await cmdFeishu(['logout'], { env: { ...creds }, loadDotenv: false, tokenFile: file });
  assert.equal(res.exitCode, 0);
  assert.ok(!existsSync(file));
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('unknown subcommand returns help/usage with non-zero exit', async () => {
  const res = await cmdFeishu(['bogus'], { env: {}, loadDotenv: false, tokenFile: tmpFile() });
  assert.notEqual(res.exitCode, 0);
  assert.match(res.stderr + res.stdout, /login|status|logout/);
});
