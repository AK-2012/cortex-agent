// input:  Node test runner + client/src/auth-headers.ts
// output: token resolution + WS auth header construction tests
// pos:    Regression guard for cortex-client WS bearer-token auth (x-cortex-token)
// >>> If I am updated, update me and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientToken, buildClientHeaders } from '../../src/auth-headers.js';

test('resolveClientToken prefers env CORTEX_CLIENT_TOKEN over config', () => {
  assert.equal(
    resolveClientToken({ clientToken: 'from-config' }, { CORTEX_CLIENT_TOKEN: 'from-env' }),
    'from-env',
  );
});

test('resolveClientToken falls back to config clientToken when env is unset', () => {
  assert.equal(resolveClientToken({ clientToken: 'from-config' }, {}), 'from-config');
});

test('resolveClientToken trims and treats blank as empty', () => {
  assert.equal(resolveClientToken({ clientToken: '  cfgtok  ' }, {}), 'cfgtok');
  assert.equal(resolveClientToken({ clientToken: '   ' }, { CORTEX_CLIENT_TOKEN: '  ' }), '');
});

test('resolveClientToken returns empty string when neither source is set', () => {
  assert.equal(resolveClientToken({}, {}), '');
});

test('buildClientHeaders returns the x-cortex-token header for a non-empty token', () => {
  assert.deepEqual(buildClientHeaders('tok123'), { 'x-cortex-token': 'tok123' });
});

test('buildClientHeaders returns undefined for an empty/blank token', () => {
  assert.equal(buildClientHeaders(''), undefined);
  assert.equal(buildClientHeaders('   '), undefined);
});
