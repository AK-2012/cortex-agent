#!/usr/bin/env node
// Smoke test: TUI AskUserQuestion drive-through — Scenario 7
// Verifies ask-user.requested → modal.open → modal.submit → ask-user.answered flow
// through the TUI gateway.
//
// Expected frames (server→client): handshake.ack, session.switched, chat.post,
//   modal.open, modal.ack
// Expected frames (client→server): handshake.hello, action.click, modal.submit
// Note: hook-bridge-subscribers uses adapter.postMessage (not postInteractive) for the
// question card, so the frame type is chat.post (not interactive.post). The Answer button
// is embedded in richBlocks as a visual action block.
//
// Usage: node --import tsx scripts/smoke-tui-askuser.mjs

import { WebSocket } from 'ws';
import * as crypto from 'crypto';
import { TuiGatewayAdapter } from '../src/platform/adapters/tui/tui-gateway.js';
import { EventBus } from '../src/events/event-bus.js';
import { initInteractionHandlers, registerInteractionHandlers } from '../src/orchestration/interactions/interaction-handlers.js';
import { registerHookBridgeSubscribers } from '../src/orchestration/routing/hook-bridge-subscribers.js';
import { PlanApprovals } from '../src/orchestration/interactions/plan-approvals.js';

const log = console.log;

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  let exitCode = 0;
  let adapter = null;
  let ws = null;
  let cleanedUp = false;

  const passed = [];
  const failed = [];

  function assert(label, ok, detail) {
    if (ok) {
      passed.push(label);
      log(`  ✓ ${label}`);
    } else {
      failed.push({ label, detail });
      log(`  ✗ ${label}: ${detail || ''}`);
    }
  }

  async function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    try { ws?.close(); } catch {}
    try { await adapter?.stop(); } catch {}
  }

  process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
  process.on('uncaughtException', async (e) => { log('UNCAUGHT:', e.message); await cleanup(); process.exit(2); });

  try {
    // ── 1. Setup: EventBus + Adapter + Interaction Handlers ────────
    const bus = new EventBus();
    adapter = new TuiGatewayAdapter({ port: 0, host: '127.0.0.1' });
    adapter.setBus(bus);
    initInteractionHandlers(bus);
    registerInteractionHandlers(adapter);
    registerHookBridgeSubscribers(bus, adapter, new PlanApprovals(bus));

    // Subscribe to ask-user.answered to detect completion
    let askUserAnsweredEvent = null;
    bus.subscribe('ask-user.answered', (e) => {
      askUserAnsweredEvent = e;
    });

    await adapter.start();
    const addr = adapter._wss.address();
    const port = addr.port;
    log(`TUI gateway listening on ws://127.0.0.1:${port}`);

    // ── 2. Connect WebSocket client ────────────────────────────────
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const frames = [];
    ws.on('message', (data) => frames.push(JSON.parse(data.toString())));

    // ── 3. Handshake ──────────────────────────────────────────────
    ws.send(JSON.stringify({
      type: 'handshake.hello',
      protocolVersion: 1,
      clientName: 'smoke',
      clientVersion: '1.0',
      project: 'general',
    }));
    await delay(1000);

    const ack = frames.find(f => f.type === 'handshake.ack');
    assert('S1: handshake.ack received', !!ack, ack ? `conduitId=${ack.conduitId}` : 'not received');

    const switched = frames.find(f => f.type === 'session.switched');
    assert('S2: session.switched received', !!switched, switched ? `sessionId=${switched.sessionId} isFresh=${switched.isFresh}` : 'not received');

    const conduitId = ack?.conduitId;
    const sessionId = switched?.sessionId;

    // Drain boot frames
    frames.length = 0;

    if (!conduitId || !sessionId) {
      log('FATAL: missing conduitId or sessionId — cannot proceed');
      exitCode = 1;
      return;
    }

    // ── 4. Publish ask-user.requested on EventBus ────────────────
    const requestId = crypto.randomUUID();
    bus.publish({
      type: 'ask-user.requested',
      requestId,
      channel: conduitId,
      sessionId,
      questions: [{
        question: 'What is your favorite color?',
        header: 'Color',
        options: [
          { label: 'Red', description: 'A warm color' },
          { label: 'Blue', description: 'A calm color' },
        ],
        multiSelect: false,
      }],
    });

    await delay(500);

    const chatPost = frames.find(f => f.type === 'chat.post');
    assert('S3: chat.post received (question card)', !!chatPost, chatPost ? `text=${chatPost.content?.text}` : 'not received');

    // ── 5. Send action.click to trigger modal open ────────────────
    const groupId = `${sessionId}:${requestId}`;
    const actionTriggerId = `tui:${conduitId}:${crypto.randomUUID()}`;

    ws.send(JSON.stringify({
      type: 'action.click',
      id: crypto.randomUUID(),
      actionId: 'ask_user_question_open_modal',
      value: groupId,
      triggerId: actionTriggerId,
      userId: 'tui',
    }));

    await delay(500);

    const modalOpen = frames.find(f => f.type === 'modal.open');
    assert('S4: modal.open received', !!modalOpen, modalOpen ? `callbackId=${modalOpen.modal?.callbackId}` : 'not received');

    if (modalOpen) {
      assert('S4a: modal.callbackId is ask_user_question_modal_submit',
        modalOpen.modal?.callbackId === 'ask_user_question_modal_submit',
        `got ${modalOpen.modal?.callbackId}`);
      assert('S4b: modal has question fields', (modalOpen.modal?.fields?.length ?? 0) > 0,
        `fields count: ${modalOpen.modal?.fields?.length}`);
    }

    // ── 6. Send modal.submit with answer ──────────────────────────
    ws.send(JSON.stringify({
      type: 'modal.submit',
      id: crypto.randomUUID(),
      callbackId: 'ask_user_question_modal_submit',
      privateMetadata: JSON.stringify({ groupId }),
      values: {
        q_0: {
          selection: { selectedOption: { value: '0' } },
        },
      },
      userId: 'tui',
    }));

    await delay(500);

    const modalAck = frames.find(f => f.type === 'modal.ack');
    assert('S5: modal.ack received', !!modalAck, modalAck ? `errors=${JSON.stringify(modalAck.errors)}` : 'not received');
    if (modalAck) {
      assert('S5a: modal.ack has no errors', !modalAck.errors, `errors=${JSON.stringify(modalAck.errors)}`);
    }

    // ── 7. Verify ask-user.answered event on bus ─────────────────
    assert('S6: ask-user.answered event published', !!askUserAnsweredEvent,
      askUserAnsweredEvent ? `channel=${askUserAnsweredEvent.channel}` : 'not published');

    if (askUserAnsweredEvent) {
      assert('S6a: ask-user.answered channel matches conduitId',
        askUserAnsweredEvent.channel === conduitId,
        `got ${askUserAnsweredEvent.channel}, expected ${conduitId}`);
      assert('S6b: ask-user.answered has answer content',
        !!askUserAnsweredEvent.answer,
        `answer=${askUserAnsweredEvent.answer}`);
    }

  } catch (err) {
    log(`\nERROR: ${err.message}`);
    console.error(err);
    exitCode = 1;
  } finally {
    await cleanup();
  }

  const total = passed.length + failed.length;
  const ok = failed.length === 0;
  log(`\nResult: ${ok ? 'PASS' : 'FAIL'} (${passed.length}/${total} passed)`);
  process.exit(ok ? 0 : 1);
}

main();
