import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { mkdirSync } from 'node:fs';
import { PIAdapter } from '../src/agent-adapter/pi/adapter.js';
import type { PIAgentProcess } from '../src/agent-adapter/pi/adapter.js';

const SESSION_DIR = pathJoin(tmpdir(), 'pi-shims-test-' + process.pid);
mkdirSync(SESSION_DIR, { recursive: true });

function makeStubChild(): any {
  const emitter = new EventEmitter() as any;
  const stdin = new PassThrough() as any;
  stdin.writeHistory = [] as string[];
  const origWrite = stdin.write.bind(stdin);
  stdin.write = (chunk: any, ...rest: any[]) => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    stdin.writeHistory.push(s);
    return origWrite(chunk, ...rest);
  };
  emitter.stdin = stdin;
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.__killed = false;
  emitter.kill = () => { if (emitter.__killed) return false; emitter.__killed = true; return true; };
  return emitter;
}

function makeStubSpawner() {
  const children: any[] = [];
  return { children, spawn: () => { const c = makeStubChild(); children.push(c); return c; } };
}

function pushLine(child: any, obj: any) { child.stdout.write(JSON.stringify(obj) + '\n'); }

async function bootstrap(child: any, sessionId = 'sess-abc') {
  pushLine(child, { type: 'response', id: 'bootstrap', command: 'get_state', success: true, data: { sessionId } });
  await Promise.resolve();
}

// Tests A-D (same as before)
test('A: basic send', async () => {
  const s = makeStubSpawner();
  const adapter = new PIAdapter(s.spawn, SESSION_DIR);
  const proc = adapter.spawn({ sessionKey: 'k1', sessionId: null, resume: false });
  const child = s.children[0];
  await bootstrap(child);
  const turnPromise = proc.send({ text: 'hello' });
  pushLine(child, { type: 'agent_end', messages: [{ role: 'assistant', content: 'ok', usage: { cost: { total: 0.005 } } }] });
  await Promise.resolve();
  const result = await turnPromise;
  assert.equal(result.sessionId, 'sess-abc');
  child.emit('close', 0);
  await proc.close();
});

test('B: rate limit', async () => {
  const s = makeStubSpawner();
  const adapter = new PIAdapter(s.spawn, SESSION_DIR);
  const proc = adapter.spawn({ sessionKey: 'k2', sessionId: null, resume: false });
  const child = s.children[0];
  await bootstrap(child);
  const turnPromise = proc.send({ text: 'do stuff' });
  pushLine(child, { type: 'auto_retry_start', reason: 'rate limit' });
  await Promise.resolve();
  pushLine(child, { type: 'agent_end', messages: [] });
  await Promise.resolve();
  const result = await turnPromise;
  assert.equal(result.rateLimited, true);
  child.emit('close', 0);
  await proc.close();
});

test('C: sendExtensionUiResponse', async () => {
  const s = makeStubSpawner();
  const adapter = new PIAdapter(s.spawn, SESSION_DIR);
  const proc = adapter.spawn({ sessionKey: 'k3', sessionId: null, resume: false }) as PIAgentProcess;
  const child = s.children[0];
  await bootstrap(child);
  proc.sendExtensionUiResponse('ui-req-1', { confirmed: true });
  const written = child.stdin.writeHistory.find((w: string) => w.includes('extension_ui_response'));
  assert.ok(written);
  child.emit('close', 0);
  await proc.close();
});

test('D: sendExtensionUiResponse with value', async () => {
  const s = makeStubSpawner();
  const adapter = new PIAdapter(s.spawn, SESSION_DIR);
  const proc = adapter.spawn({ sessionKey: 'k4', sessionId: null, resume: false }) as PIAgentProcess;
  const child = s.children[0];
  await bootstrap(child);
  proc.sendExtensionUiResponse('ui-req-2', { value: 'Option A' });
  const written = child.stdin.writeHistory.find((w: string) => w.includes('extension_ui_response'));
  assert.ok(written);
  child.emit('close', 0);
  await proc.close();
});

// Test E: plan->approval->resume (complex flow)
test('E: plan flow', async () => {
  const s = makeStubSpawner();
  const adapter = new PIAdapter(s.spawn, SESSION_DIR);
  const proc = adapter.spawn({ sessionKey: 'k5', sessionId: null, resume: false }) as PIAgentProcess;
  const child = s.children[0];
  await bootstrap(child);
  const turnPromise = proc.send({ text: 'build a feature' });

  const PLAN_PATH = '/repo/plan/my-plan.md';
  pushLine(child, { type: 'tool_execution_start', toolCallId: 'tc-write', toolName: 'write', args: { file_path: PLAN_PATH, content: 'Plan: do X' } });
  pushLine(child, { type: 'tool_execution_end', toolCallId: 'tc-write', result: { content: [{ type: 'text', text: 'Written.' }] } });
  await Promise.resolve();

  pushLine(child, { type: 'tool_execution_start', toolCallId: 'tc-epm', toolName: 'exit_plan_mode', args: { plan: 'Plan: do X' } });
  await Promise.resolve();

  const collectedEvents: string[] = [];
  const collectLoop = (async () => { for await (const evt of proc.events) { collectedEvents.push(evt.type); if (evt.type === 'turn_complete') break; } })();

  pushLine(child, { type: 'extension_ui_request', id: 'ui-confirm-1', method: 'confirm', title: 'Plan ready for review — approve to proceed with implementation.' });
  await Promise.resolve();
  proc.sendExtensionUiResponse('ui-confirm-1', { confirmed: true });
  pushLine(child, { type: 'tool_execution_end', toolCallId: 'tc-epm', result: { content: [{ type: 'text', text: 'Plan approved.' }] } });
  pushLine(child, { type: 'agent_end', messages: [{ role: 'assistant', content: 'done', usage: { cost: { total: 0.01 } } }] });
  await Promise.resolve();
  await Promise.resolve();

  const result = await turnPromise;
  await collectLoop;
  assert.equal(result.planFilePath, PLAN_PATH);
  assert.equal(result.exitedPlanMode, true);
  child.emit('close', 0);
  await proc.close();
});

// Test F: ask_user_question via extension_ui
test('F: ask_user_question', async () => {
  const s = makeStubSpawner();
  const adapter = new PIAdapter(s.spawn, SESSION_DIR);
  const proc = adapter.spawn({ sessionKey: 'k6', sessionId: null, resume: false }) as PIAgentProcess;
  const child = s.children[0];
  await bootstrap(child);
  const turnPromise = proc.send({ text: 'ask me something' });
  pushLine(child, { type: 'tool_execution_start', toolCallId: 'tc-aq', toolName: 'ask_user_question', args: { questions: [{ question: 'What color?' }] } });
  await Promise.resolve();
  pushLine(child, { type: 'extension_ui_request', id: 'ui-sel-1', method: 'select', title: 'What color?', options: ['Red', 'Blue'] });
  await Promise.resolve();
  proc.sendExtensionUiResponse('ui-sel-1', { value: 'Blue' });
  pushLine(child, { type: 'tool_execution_end', toolCallId: 'tc-aq', result: { content: [{ type: 'text', text: 'Blue' }] } });
  pushLine(child, { type: 'agent_end', messages: [] });
  await Promise.resolve();
  const result = await turnPromise;
  assert.equal(result.askUserQuestions, undefined);
  child.emit('close', 0);
  await proc.close();
});

// Test G: fatal error
test('G: fatal error', async () => {
  const s = makeStubSpawner();
  const adapter = new PIAdapter(s.spawn, SESSION_DIR);
  const proc = adapter.spawn({ sessionKey: 'k7', sessionId: null, resume: false });
  const child = s.children[0];
  await bootstrap(child);
  const turnPromise = proc.send({ text: 'do something' });
  child.stderr.write('fatal: something broke\n');
  child.emit('close', 1);
  await Promise.resolve();
  await assert.rejects(turnPromise, /fatal|something broke|exited/i);
  await proc.close().catch(() => {});
});

// Test H: clean exit without turn_complete
test('H: clean exit before turn_complete', async () => {
  const s = makeStubSpawner();
  const adapter = new PIAdapter(s.spawn, SESSION_DIR);
  const proc = adapter.spawn({ sessionKey: 'k8', sessionId: null, resume: false });
  const child = s.children[0];
  await bootstrap(child);
  const turnPromise = proc.send({ text: 'do work' });
  child.emit('close', 0);
  await Promise.resolve();
  await assert.rejects(turnPromise, /exited before turn_complete/i);
  await proc.close().catch(() => {});
});

console.error("All tests registered");
