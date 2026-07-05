// input:  Node test runner + domain/threads/shell-templates + template-loader
// output: expandShellTemplate / isShellBinding coverage (expansion / validation / error branches) + loadConfig fail-soft
// pos:    DR-0017 D6 Phase 2 — worker-review shell inheritance
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import '../_test-home.js'; // MUST be first: isolate CORTEX_HOME before paths.ts loads
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { expandShellTemplate, isShellBinding } from '../../src/domain/threads/shell-templates.js';
import { loadConfig } from '../../src/domain/threads/template-loader.js';
import { CONFIG_DIR } from '../../src/core/paths.js';
import type { AgentDefinition } from '../../src/core/types/thread-types.js';

// --- Fixture agents mirroring the real worker/reviewer agent shapes ---
function workerAgent(name: string, produceStage: string): AgentDefinition {
  return {
    name,
    profile: '__active__',
    persistSession: true,
    entryStage: produceStage,
    stages: {
      [produceStage]: { promptTemplate: `file:${name}-${produceStage}.md` },
      retry: { promptTemplate: `file:${name}-retry.md` },
    },
  };
}
function reviewerAgent(name: string): AgentDefinition {
  return { name, profile: '__active__', persistSession: true };
}

const AGENTS: Record<string, AgentDefinition> = {
  analyst: workerAgent('analyst', 'analyze'),
  'analyst-reviewer': reviewerAgent('analyst-reviewer'),
  surveyor: workerAgent('surveyor', 'survey'),
  'surveyor-reviewer': reviewerAgent('surveyor-reviewer'),
  writer: workerAgent('writer', 'write'),
  'writer-reviewer': reviewerAgent('writer-reviewer'),
  'doc-writer': workerAgent('doc-writer', 'write'),
  'doc-reviewer': reviewerAgent('doc-reviewer'),
  executor: workerAgent('executor', 'execute'),
  'executor-reviewer': reviewerAgent('executor-reviewer'),
};

// --- isShellBinding ---

test('isShellBinding distinguishes shell bindings from full templates', () => {
  assert.equal(isShellBinding({ shell: 'worker-review', worker: 'a', reviewer: 'b' }), true);
  assert.equal(isShellBinding({ name: 'x', agents: [], transitions: [], entryAgent: 'a', maxTotalSteps: 4 }), false);
  assert.equal(isShellBinding(null), false);
  assert.equal(isShellBinding('str'), false);
});

// --- Expansion: behavior equivalence (independent golden literals) ---
// These two literals are the EXACT current defaults full templates (pre-conversion),
// pinning that shell expansion is behavior-preserving.

const GOLDEN_DOC_REVIEW = {
  name: 'doc-review',
  description: 'Generic produce-then-audit for documents (status / digest / decision / report / knowledge entry). Stages: doc-writer(write) → doc-reviewer → (if not [APPROVED]) doc-writer(retry, write [REVISED] at end) → END',
  agents: ['doc-writer', 'doc-reviewer'],
  transitions: [
    { from: 'doc-writer:write', to: 'doc-reviewer', condition: { type: 'always' } },
    { from: 'doc-reviewer', to: 'doc-writer:retry', condition: { type: 'convergence', marker: '[APPROVED]', maxIterations: 1 } },
    { from: 'doc-writer:retry', to: 'doc-reviewer', condition: { type: 'output_not_contains', pattern: '\\[REVISED\\]' } },
  ],
  entryAgent: 'doc-writer',
  entryStage: 'write',
  maxTotalSteps: 4,
  hooks: { onEnd: { command: 'node ~/.cortex/hooks/post-task-hook.mjs', args: ['doc-writer'], timeout: 10000 } },
};

const GOLDEN_EXECUTE_REVIEW = {
  name: 'execute-review',
  description: 'Execute-then-review: executor executes task → executor-reviewer audits → at most 1 retry. Suitable for any verifiable task (code changes, config changes, file edits, script execution, etc.)',
  agents: ['executor', 'executor-reviewer'],
  transitions: [
    { from: 'executor:execute', to: 'executor-reviewer', condition: { type: 'always' } },
    { from: 'executor-reviewer', to: 'executor:retry', condition: { type: 'convergence', marker: '[APPROVED]', maxIterations: 1 } },
    { from: 'executor:retry', to: 'executor-reviewer', condition: { type: 'output_not_contains', pattern: '\\[REVISED\\]' } },
  ],
  entryAgent: 'executor',
  entryStage: 'execute',
  maxTotalSteps: 4,
  hooks: { onEnd: { command: 'node ~/.cortex/hooks/post-task-hook.mjs', args: ['executor'], timeout: 10000 } },
};

test('expandShellTemplate(doc-review) equals the pre-conversion full template', () => {
  const out = expandShellTemplate('doc-review', {
    shell: 'worker-review', worker: 'doc-writer', reviewer: 'doc-reviewer',
    description: GOLDEN_DOC_REVIEW.description,
  }, AGENTS);
  assert.deepEqual(out, GOLDEN_DOC_REVIEW);
});

test('expandShellTemplate(execute-review) equals the pre-conversion full template', () => {
  const out = expandShellTemplate('execute-review', {
    shell: 'worker-review', worker: 'executor', reviewer: 'executor-reviewer',
    description: GOLDEN_EXECUTE_REVIEW.description,
  }, AGENTS);
  assert.deepEqual(out, GOLDEN_EXECUTE_REVIEW);
});

// --- Expansion: structural coverage for the live-only workers ---

for (const [name, worker, reviewer, produce] of [
  ['analyst-review', 'analyst', 'analyst-reviewer', 'analyze'],
  ['surveyor-review', 'surveyor', 'surveyor-reviewer', 'survey'],
  ['writer-review', 'writer', 'writer-reviewer', 'write'],
] as const) {
  test(`expandShellTemplate(${name}) builds the standard convergence loop`, () => {
    const out = expandShellTemplate(name, { shell: 'worker-review', worker, reviewer }, AGENTS);
    assert.equal(out.name, name);
    assert.deepEqual(out.agents, [worker, reviewer]);
    assert.equal(out.entryAgent, worker);
    assert.equal(out.entryStage, produce);
    assert.equal(out.maxTotalSteps, 4);
    assert.deepEqual(out.transitions, [
      { from: `${worker}:${produce}`, to: reviewer, condition: { type: 'always' } },
      { from: reviewer, to: `${worker}:retry`, condition: { type: 'convergence', marker: '[APPROVED]', maxIterations: 1 } },
      { from: `${worker}:retry`, to: reviewer, condition: { type: 'output_not_contains', pattern: '\\[REVISED\\]' } },
    ]);
    assert.deepEqual(out.hooks?.onEnd?.args, [worker]);
  });
}

test('expandShellTemplate honors a maxTotalSteps override', () => {
  const out = expandShellTemplate('x-review', { shell: 'worker-review', worker: 'analyst', reviewer: 'analyst-reviewer', maxTotalSteps: 6 }, AGENTS);
  assert.equal(out.maxTotalSteps, 6);
});

// --- Error branches ---

test('unknown shell name throws', () => {
  assert.throws(() => expandShellTemplate('x', { shell: 'no-such-shell', worker: 'analyst', reviewer: 'analyst-reviewer' } as any, AGENTS), /unknown shell/i);
});

test('missing worker field throws', () => {
  assert.throws(() => expandShellTemplate('x', { shell: 'worker-review', reviewer: 'analyst-reviewer' } as any, AGENTS), /worker/i);
});

test('missing reviewer field throws', () => {
  assert.throws(() => expandShellTemplate('x', { shell: 'worker-review', worker: 'analyst' } as any, AGENTS), /reviewer/i);
});

test('worker agent not found throws', () => {
  assert.throws(() => expandShellTemplate('x', { shell: 'worker-review', worker: 'ghost', reviewer: 'analyst-reviewer' }, AGENTS), /worker agent .*ghost.* not found/i);
});

test('reviewer agent not found throws', () => {
  assert.throws(() => expandShellTemplate('x', { shell: 'worker-review', worker: 'analyst', reviewer: 'ghost' }, AGENTS), /reviewer agent .*ghost.* not found/i);
});

test('worker agent without entryStage throws', () => {
  const agents = { ...AGENTS, noentry: { name: 'noentry', profile: '__active__', persistSession: true, stages: { retry: { promptTemplate: 'x' } } } as AgentDefinition };
  assert.throws(() => expandShellTemplate('x', { shell: 'worker-review', worker: 'noentry', reviewer: 'analyst-reviewer' }, agents), /entryStage/i);
});

test('worker agent without retry stage throws', () => {
  const agents = { ...AGENTS, noretry: { name: 'noretry', profile: '__active__', persistSession: true, entryStage: 'go', stages: { go: { promptTemplate: 'x' } } } as AgentDefinition };
  assert.throws(() => expandShellTemplate('x', { shell: 'worker-review', worker: 'noretry', reviewer: 'analyst-reviewer' }, agents), /retry/i);
});

// --- loadConfig integration: fail-soft (a broken shell binding is skipped, others load) ---

test('loadConfig expands valid shell bindings and skips broken ones (fail-soft)', () => {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const config = {
    agents: {
      executor: workerAgent('executor', 'execute'),
      'executor-reviewer': reviewerAgent('executor-reviewer'),
    },
    templates: {
      'good-review': { shell: 'worker-review', worker: 'executor', reviewer: 'executor-reviewer', description: 'ok' },
      'broken-review': { shell: 'worker-review', worker: 'ghost', reviewer: 'executor-reviewer', description: 'bad' },
    },
  };
  writeFileSync(path.join(CONFIG_DIR, 'thread-templates.json'), JSON.stringify(config, null, 2), 'utf8');
  const { templates } = loadConfig();
  assert.ok(templates['good-review'], 'valid shell binding expanded');
  assert.equal(templates['good-review'].entryAgent, 'executor');
  assert.equal(templates['good-review'].transitions.length, 3);
  assert.equal(templates['broken-review'], undefined, 'broken shell binding skipped');
});
