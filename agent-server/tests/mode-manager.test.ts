// input:  Node test runner + mode-manager + gateway mock
// output: per-request /m/{mode}/ + fallback tests
// pos:    Verify mode-manager URL prefix routing and fallback
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { importFresh } from './module-loader.js';

// Standard import (no cache buster) — same singleton instance that mode-manager uses
import { _testSetHealthy, GATEWAY_URL } from './../src/domain/costs/gateway-manager.js';

test('configureEnvForMode(api) encodes mode in URL when gateway healthy', async (t) => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;

  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;

  t.after(() => {
    _testSetHealthy(null);
    if (originalApiKey !== undefined) process.env.ANTHROPIC_API_KEY = originalApiKey;
    else delete process.env.ANTHROPIC_API_KEY;
    if (originalBaseUrl !== undefined) process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    else delete process.env.ANTHROPIC_BASE_URL;
  });

  _testSetHealthy(true);
  const modeManager = await importFresh('./../src/domain/agents/index.js');

  process.env.ANTHROPIC_API_KEY = 'sk-test-late';
  process.env.ANTHROPIC_BASE_URL = 'https://late.example.test';
  modeManager.configureEnvForMode('api');

  assert.equal(process.env.ANTHROPIC_BASE_URL, `${GATEWAY_URL}/m/api/anthropic`,
    'api mode should encode mode in URL path: /m/api/anthropic');
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined,
    'api mode should clear API key — gateway manages auth');
});

test('configureEnvForMode(plan) encodes mode in URL when gateway healthy', async (t) => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;

  process.env.ANTHROPIC_API_KEY = 'sk-test-plan';
  process.env.ANTHROPIC_BASE_URL = 'https://managed.example.test';

  t.after(() => {
    _testSetHealthy(null);
    if (originalApiKey !== undefined) process.env.ANTHROPIC_API_KEY = originalApiKey;
    else delete process.env.ANTHROPIC_API_KEY;
    if (originalBaseUrl !== undefined) process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    else delete process.env.ANTHROPIC_BASE_URL;
  });

  _testSetHealthy(true);
  const modeManager = await importFresh('./../src/domain/agents/index.js');
  modeManager.configureEnvForMode('plan');

  assert.equal(process.env.ANTHROPIC_API_KEY, undefined,
    'plan mode should clear API key (OAuth)');
  assert.equal(process.env.ANTHROPIC_BASE_URL, `${GATEWAY_URL}/m/plan/anthropic`,
    'plan mode should encode mode in URL path: /m/plan/anthropic');
});

test('configureEnvForMode(api) falls back to direct when gateway unhealthy', async (t) => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;

  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;

  t.after(() => {
    _testSetHealthy(null);
    if (originalApiKey !== undefined) process.env.ANTHROPIC_API_KEY = originalApiKey;
    else delete process.env.ANTHROPIC_API_KEY;
    if (originalBaseUrl !== undefined) process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    else delete process.env.ANTHROPIC_BASE_URL;
  });

  _testSetHealthy(false);
  const modeManager = await importFresh('./../src/domain/agents/index.js');

  process.env.ANTHROPIC_API_KEY = 'sk-test-direct';
  process.env.ANTHROPIC_BASE_URL = 'https://saved.example.test';
  modeManager.configureEnvForMode('api');

  assert.equal(process.env.ANTHROPIC_API_KEY, 'sk-test-direct',
    'api mode should restore API key when gateway unhealthy');
  assert.ok(!process.env.ANTHROPIC_BASE_URL?.includes('/m/'),
    'api mode should NOT use mode URL prefix when gateway unhealthy');
});

test('configureEnvForMode(plan) falls back to direct when gateway unhealthy', async (t) => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalBaseUrl = process.env.ANTHROPIC_BASE_URL;

  process.env.ANTHROPIC_API_KEY = 'sk-test-plan-direct';
  process.env.ANTHROPIC_BASE_URL = 'https://plan.example.test';

  t.after(() => {
    _testSetHealthy(null);
    if (originalApiKey !== undefined) process.env.ANTHROPIC_API_KEY = originalApiKey;
    else delete process.env.ANTHROPIC_API_KEY;
    if (originalBaseUrl !== undefined) process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    else delete process.env.ANTHROPIC_BASE_URL;
  });

  _testSetHealthy(false);
  const modeManager = await importFresh('./../src/domain/agents/index.js');
  modeManager.configureEnvForMode('plan');

  assert.equal(process.env.ANTHROPIC_API_KEY, undefined,
    'plan mode should clear API key even when gateway unhealthy');
  assert.equal(process.env.ANTHROPIC_BASE_URL, undefined,
    'plan mode should remove base URL for direct OAuth when gateway unhealthy');
});

test('GATEWAY_ANTHROPIC_URL has /anthropic suffix (backward compat)', async (t) => {
  const modeManager = await importFresh('./../src/domain/agents/index.js');
  assert.ok(modeManager.GATEWAY_ANTHROPIC_URL.endsWith('/anthropic'),
    'gateway URL should end with /anthropic endpoint');
  assert.ok(modeManager.GATEWAY_ANTHROPIC_URL.startsWith('http://127.0.0.1:'),
    'gateway URL should be localhost');
});

test('gatewayModeUrl builds per-request mode URL', async (t) => {
  const modeManager = await importFresh('./../src/domain/agents/index.js');
  const planUrl = modeManager.gatewayModeUrl('plan');
  const apiUrl = modeManager.gatewayModeUrl('api');

  assert.ok(planUrl.includes('/m/plan/anthropic'), 'plan URL should contain /m/plan/anthropic');
  assert.ok(apiUrl.includes('/m/api/anthropic'), 'api URL should contain /m/api/anthropic');
  assert.notEqual(planUrl, apiUrl, 'plan and api URLs should differ');
  assert.ok(planUrl.startsWith('http://127.0.0.1:'), 'should be localhost');
});
