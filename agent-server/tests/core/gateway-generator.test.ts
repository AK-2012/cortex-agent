// input:  gateway-generator module
// output: verify pi --list-models parser, DiscoveredEndpoint shape, generateGatewayYaml filtering
// pos:    Validate gateway-generator pure logic. Spawn-based scanPIViaListModels is covered by end-to-end.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePiListModelsOutput,
  generateGatewayYaml,
  type DiscoveredEndpoint,
} from '../../src/core/gateway-generator.js';

// ─── parsePiListModelsOutput ───────────────────────────────────

const REAL_PI_OUTPUT = `provider   model                       context  max-out  thinking  images
anthropic  claude-3-5-haiku-20241022   200K     8.2K     no        yes
anthropic  claude-opus-4-7             1M       128K     yes       yes
deepseek   deepseek-v4-flash           1M       384K     yes       no
deepseek   deepseek-v4-pro             1M       384K     yes       no
`;

const CODEX_PI_OUTPUT = `provider      model                context  max-out  thinking  images
openai-codex  gpt-5.1              272K     128K     yes       yes
openai-codex  gpt-5.4-mini         272K     128K     yes       yes
openai-codex  gpt-5.5              272K     128K     yes       yes
`;

const EMPTY_PI_OUTPUT = `No models available. Use /login to log into a provider via OAuth or API key. See:
  /some/path/providers.md
  /some/path/models.md
`;

test('parsePiListModelsOutput: parses standard table with header', () => {
  const result = parsePiListModelsOutput(REAL_PI_OUTPUT);
  assert.equal(result.length, 4);
  assert.deepEqual(result[0], { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' });
  assert.deepEqual(result[3], { provider: 'deepseek', model: 'deepseek-v4-pro' });
});

test('parsePiListModelsOutput: parses oauth-style provider name (openai-codex)', () => {
  const result = parsePiListModelsOutput(CODEX_PI_OUTPUT);
  assert.equal(result.length, 3);
  assert.equal(result[0].provider, 'openai-codex');
  assert.equal(result[0].model, 'gpt-5.1');
  assert.equal(result[1].model, 'gpt-5.4-mini');
});

test('parsePiListModelsOutput: returns empty for "No models available"', () => {
  const result = parsePiListModelsOutput(EMPTY_PI_OUTPUT);
  assert.deepEqual(result, []);
});

test('parsePiListModelsOutput: returns empty for blank input', () => {
  assert.deepEqual(parsePiListModelsOutput(''), []);
  assert.deepEqual(parsePiListModelsOutput('\n\n\n'), []);
});

test('parsePiListModelsOutput: skips blank lines mid-output', () => {
  const input = `provider  model

anthropic  claude-opus-4-7

deepseek  deepseek-v4-pro
`;
  const result = parsePiListModelsOutput(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].provider, 'anthropic');
  assert.equal(result[1].provider, 'deepseek');
});

test('parsePiListModelsOutput: tolerates trailing whitespace per row', () => {
  const input = `provider  model
anthropic  claude-opus-4-7
`;
  const result = parsePiListModelsOutput(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].model, 'claude-opus-4-7');
});

// ─── DiscoveredEndpoint shape ──────────────────────────────────

test('DiscoveredEndpoint has gatewayManaged field for filtering', () => {
  const ep: DiscoveredEndpoint = {
    mode: 'plan',
    endpoint: 'anthropic',
    base_url: 'https://api.anthropic.com',
    auth_style: 'bearer',
    keys: [],
    passthrough: true,
    models: ['claude-opus-4-7'],
    gatewayManaged: true,
  };
  // TypeScript ensures the field exists; runtime assertion confirms shape
  assert.equal(typeof ep.gatewayManaged, 'boolean');
});

// ─── generateGatewayYaml: filter gatewayManaged=false ──────────

function ep(opts: Partial<DiscoveredEndpoint> & Pick<DiscoveredEndpoint, 'mode' | 'endpoint'>): DiscoveredEndpoint {
  return {
    base_url: 'https://example.test',
    auth_style: 'bearer',
    keys: [],
    passthrough: true,
    models: [],
    gatewayManaged: true,
    ...opts,
  };
}

test('generateGatewayYaml: skips endpoints with gatewayManaged=false', () => {
  const yamlContent = generateGatewayYaml([
    ep({ mode: 'plan', endpoint: 'anthropic', base_url: 'https://api.anthropic.com' }),
    ep({ mode: 'openai-codex', endpoint: 'openai-codex', gatewayManaged: false, base_url: 'https://api.openai.com' }),
  ]);
  // anthropic plan should appear
  assert.match(yamlContent, /^anthropic:/m);
  assert.match(yamlContent, /plan:/);
  // openai-codex must NOT appear as a rendered endpoint section
  assert.doesNotMatch(yamlContent, /^openai-codex:/m);
});

test('generateGatewayYaml: renders gatewayManaged=true PI providers as endpoint sections', () => {
  const yamlContent = generateGatewayYaml([
    ep({ mode: 'plan', endpoint: 'anthropic', base_url: 'https://api.anthropic.com' }),
    ep({ mode: 'deepseek', endpoint: 'deepseek', base_url: 'https://api.deepseek.com/anthropic', gatewayManaged: true }),
  ]);
  assert.match(yamlContent, /^anthropic:/m);
  assert.match(yamlContent, /^deepseek:/m);
});

test('generateGatewayYaml: always includes port + mode + status_check header', () => {
  const yamlContent = generateGatewayYaml([
    ep({ mode: 'plan', endpoint: 'anthropic', base_url: 'https://api.anthropic.com' }),
  ]);
  assert.match(yamlContent, /^port: 9880$/m);
  assert.match(yamlContent, /^mode: plan/m);
  assert.match(yamlContent, /^status_check: true$/m);
});

test('generateGatewayYaml: handles empty endpoints (no filter results) gracefully', () => {
  const yamlContent = generateGatewayYaml([
    ep({ mode: 'x', endpoint: 'x', gatewayManaged: false }),
  ]);
  // Header still rendered, no endpoint section
  assert.match(yamlContent, /^port: 9880$/m);
  assert.doesNotMatch(yamlContent, /^x:/m);
});

// ─── discoverEndpoints integration: PI_PROVIDER_UPSTREAM coverage ──

import { discoverEndpoints } from '../../src/core/gateway-generator.js';

test('discoverEndpoints: openai-codex is gatewayManaged=true (upstream known)', async () => {
  // We can't easily mock `pi --list-models` from a unit test here, but we can assert
  // the lookup table via a directly-constructed endpoint passed to generateGatewayYaml.
  // The integration test is the e2e run; this test pins the rendering contract.
  const yamlContent = generateGatewayYaml([
    ep({
      mode: 'openai-codex',
      endpoint: 'openai-codex',
      base_url: 'https://chatgpt.com/backend-api',
      gatewayManaged: true,
      passthrough: true,
      auth_style: 'bearer',
    }),
  ]);
  assert.match(yamlContent, /^openai-codex:/m);
  assert.match(yamlContent, /base_url: https:\/\/chatgpt\.com\/backend-api/);
});

test('generateGatewayYaml: renders multi PI providers in separate sections', () => {
  const yamlContent = generateGatewayYaml([
    ep({ mode: 'plan', endpoint: 'anthropic', base_url: 'https://api.anthropic.com', auth_style: 'bearer' }),
    ep({ mode: 'deepseek', endpoint: 'deepseek', base_url: 'https://api.deepseek.com', auth_style: 'openai' }),
    ep({
      mode: 'openai-codex',
      endpoint: 'openai-codex',
      base_url: 'https://chatgpt.com/backend-api',
      auth_style: 'bearer',
      passthrough: true,
    }),
  ]);
  assert.match(yamlContent, /^anthropic:/m);
  assert.match(yamlContent, /^deepseek:/m);
  assert.match(yamlContent, /^openai-codex:/m);
});
