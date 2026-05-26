// input:  CompositeAdapter + FanOutOutputStream + extractTuiAdapter + MockAdapter + TuiGatewayAdapter
// output: Composite adapter unit tests
// pos:    Verify fan-out routing, interactive-reply isolation, capabilities merging, extractTuiAdapter, FanOutOutputStream

import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { MockAdapter } from '../../src/platform/testing.js';
import { CompositeAdapter, extractTuiAdapter, FanOutOutputStream } from '../../src/platform/adapters/composite-adapter.js';
import { TuiGatewayAdapter, TuiConnection } from '../../src/platform/adapters/tui/index.js';
import { tuiConduitStates, setConduitState, deleteConduitState } from '../../src/platform/adapters/tui/tui-conduit-state.js';
import type { OutputStream, MutableRegion } from '../../src/platform/output-stream.js';
import type { MessageRef, RichBlock, ActionElement } from '../../src/platform/types.js';

// ── Helpers ───────────────────────────────────────────────────────

function makeMockWs(): WebSocket {
  return { send: () => {}, close: () => {}, on: () => {} } as unknown as WebSocket;
}

/** RecordingOutputStream: records all operations in a `segments` array for test assertions. */
class RecordingOutputStream implements OutputStream {
  readonly segments: string[] = [];
  readonly refs: MessageRef[] = [];
  parentRef: MessageRef | null = null;

  emitText(text: string): void {
    this.segments.push(`emit:${text}`);
  }

  openMutable(text: string): MutableRegion {
    this.segments.push(`mutable:${text}`);
    return { update: (t) => { this.segments.push(`update:${t}`); } };
  }

  async postInteractive(text: string, _opts?: { richBlocks?: RichBlock[]; actions?: ActionElement[] }): Promise<MessageRef | null> {
    this.segments.push(`interactive:${text}`);
    const ref: MessageRef = { conduit: 'test', messageId: String(this.refs.length + 1) };
    this.refs.push(ref);
    if (!this.parentRef) this.parentRef = ref;
    return ref;
  }

  async flush(): Promise<void> {
    this.segments.push('flush');
  }

  getRefs(): MessageRef[] {
    return [...this.refs];
  }

  getParentRef(): MessageRef | null {
    return this.parentRef;
  }
}

// Clean up global conduit states after each test
test.afterEach(() => {
  tuiConduitStates.clear();
});

// ── Test: Fan-out project-report ──────────────────────────────────

test('CompositeAdapter: project-report fan-out to primary and gateway', async () => {
  const primary = new MockAdapter({ adminChannel: 'C-admin' });
  const gateway = new TuiGatewayAdapter({ port: 0, host: '127.0.0.1' });
  const composite = new CompositeAdapter(primary, gateway);

  // Set up TUI connection with correct project binding
  const sentFrames: any[] = [];
  const mockWs = {
    send: (data: string) => { sentFrames.push(JSON.parse(data)); },
    close: () => {},
    on: () => {},
  } as unknown as WebSocket;
  const conn = new TuiConnection('tui-test-1', mockWs, 'test-project');
  gateway.connections.set('tui-test-1', conn);
  // Set conduit state so gateway.getProjectConduits() includes this project
  setConduitState('tui-test-1', { sessionId: null, projectId: 'test-project', backend: 'tui' });

  // Bind primary conduit
  await primary.bindProjectConduit('test-project', 'C12345');

  // Post project-report
  const ref = await composite.postMessage(
    { type: 'project-report', projectId: 'test-project', trigger: 'test', sessionId: '' },
    { text: 'hello from both' },
  );

  // Both adapters should have received the message
  assert.equal(primary.posted.length, 1);
  assert.equal(primary.posted[0].content.text, 'hello from both');
  assert.equal(primary.posted[0].destination.type, 'project-report');
  assert.equal(sentFrames.length, 1);
  assert.equal(sentFrames[0].type, 'chat.post');
  assert.equal(sentFrames[0].content.text, 'hello from both');

  // First ref should be from primary (MockAdapter returns projectId as conduit for project-report)
  assert.ok(ref.conduit !== '');
  assert.ok(ref.messageId !== '');
});

// ── Test: interactive-reply routing ───────────────────────────────

test('CompositeAdapter: interactive-reply to Slack conduit does NOT hit gateway', async () => {
  const primary = new MockAdapter({ adminChannel: 'C-admin' });
  const gateway = new TuiGatewayAdapter({ port: 0, host: '127.0.0.1' });
  const composite = new CompositeAdapter(primary, gateway);

  // Set up TUI connection
  const sentFrames: any[] = [];
  const mockWs = {
    send: (data: string) => { sentFrames.push(JSON.parse(data)); },
    close: () => {},
    on: () => {},
  } as unknown as WebSocket;
  const conn = new TuiConnection('tui-reply-1', mockWs, 'general');
  gateway.connections.set('tui-reply-1', conn);

  // Post interactive-reply to a Slack-style conduit
  const ref = await composite.postMessage(
    { type: 'interactive-reply', conduit: 'C12345', sessionId: '' },
    { text: 'slack reply' },
  );

  // Only primary should get it
  assert.equal(primary.posted.length, 1);
  assert.equal(primary.posted[0].content.text, 'slack reply');
  assert.equal(sentFrames.length, 0);
});

test('CompositeAdapter: interactive-reply to TUI conduit does NOT hit primary', async () => {
  const primary = new MockAdapter({ adminChannel: 'C-admin' });
  const gateway = new TuiGatewayAdapter({ port: 0, host: '127.0.0.1' });
  const composite = new CompositeAdapter(primary, gateway);

  // Set up TUI connection
  const sentFrames: any[] = [];
  const mockWs = {
    send: (data: string) => { sentFrames.push(JSON.parse(data)); },
    close: () => {},
    on: () => {},
  } as unknown as WebSocket;
  const conn = new TuiConnection('tui-reply-2', mockWs, 'general');
  gateway.connections.set('tui-reply-2', conn);

  // Post interactive-reply to a TUI-style conduit
  await composite.postMessage(
    { type: 'interactive-reply', conduit: 'tui-reply-2', sessionId: '' },
    { text: 'tui reply' },
  );

  // Only gateway should get it
  assert.equal(primary.posted.length, 0);
  assert.equal(sentFrames.length, 1);
  assert.equal(sentFrames[0].type, 'chat.post');
  assert.equal(sentFrames[0].content.text, 'tui reply');
});

// ── Test: system-notice goes to primary only ──────────────────────

test('CompositeAdapter: system-notice goes to primary only', async () => {
  const primary = new MockAdapter({ adminChannel: 'C-admin' });
  const gateway = new TuiGatewayAdapter({ port: 0, host: '127.0.0.1' });
  const composite = new CompositeAdapter(primary, gateway);

  const sentFrames: any[] = [];
  const mockWs = {
    send: (data: string) => { sentFrames.push(JSON.parse(data)); },
    close: () => {},
    on: () => {},
  } as unknown as WebSocket;
  const conn = new TuiConnection('tui-sys-1', mockWs, 'general');
  gateway.connections.set('tui-sys-1', conn);

  await composite.postMessage(
    { type: 'system-notice' },
    { text: 'system notice' },
  );

  // Only primary should get system-notice
  assert.equal(primary.posted.length, 1);
  assert.equal(primary.posted[0].content.text, 'system notice');
  assert.equal(primary.posted[0].destination.type, 'system-notice');
  assert.equal(sentFrames.length, 0);
});

// ── Test: openModal routing ───────────────────────────────────────

test('CompositeAdapter: openModal routes by triggerId prefix', async () => {
  const primary = new MockAdapter({ adminChannel: 'C-admin' });
  const gateway = new TuiGatewayAdapter({ port: 0, host: '127.0.0.1' });
  const composite = new CompositeAdapter(primary, gateway);

  const modal = {
    callbackId: 'test-modal',
    title: 'Test',
    fields: [],
  };

  // TUI triggerId → routes to gateway
  await composite.openModal('tui:conduit1:uuid', modal);
  assert.equal(primary.modals.length, 0); // primary not called

  // Primary triggerId → routes to primary
  await composite.openModal('slack-trigger-123', modal);
  assert.equal(primary.modals.length, 1);
  assert.equal(primary.modals[0].triggerId, 'slack-trigger-123');
});

// ── Test: capabilities merging ────────────────────────────────────

test('CompositeAdapter: capabilities merge union/intersection/min correctly', async () => {
  const primary = new MockAdapter({
    capabilities: {
      threads: true,
      messageEdit: true,
      fileUpload: true,
      modals: true,
      richFormatting: true,
      reactions: true,
      maxMessageLength: 3000,
      maxThreadDepth: 1,
    },
  });
  const gateway = new TuiGatewayAdapter({ port: 0, host: '127.0.0.1' });
  const composite = new CompositeAdapter(primary, gateway);

  const c = composite.capabilities;

  // Union: threads / messageEdit / fileUpload
  assert.equal(c.threads, true);
  assert.equal(c.messageEdit, true);
  assert.equal(c.fileUpload, true);

  // Intersection: modals (both true → true)
  assert.equal(c.modals, true);

  // Min
  assert.equal(c.maxMessageLength, Math.min(3000, 100_000));
});

test('CompositeAdapter: modals=false when one side lacks it (intersection)', async () => {
  // Gateway has modals: true (default), but primary has modals: false
  const primary = new MockAdapter({
    adminChannel: 'C-admin',
    capabilities: { modals: false },
  });
  const gateway = new TuiGatewayAdapter({ port: 0, host: '127.0.0.1' });
  const composite = new CompositeAdapter(primary, gateway);

  assert.equal(composite.capabilities.modals, false);
});

// ── Test: extractTuiAdapter ───────────────────────────────────────

test('extractTuiAdapter: returns gateway from CompositeAdapter', () => {
  const primary = new MockAdapter({ adminChannel: 'C-admin' });
  const gateway = new TuiGatewayAdapter({ port: 0, host: '127.0.0.1' });
  const composite = new CompositeAdapter(primary, gateway);

  const extracted = extractTuiAdapter(composite);
  assert.ok(extracted !== null);
  assert.equal(extracted, gateway);
});

test('extractTuiAdapter: returns self for bare TuiGatewayAdapter', () => {
  const gateway = new TuiGatewayAdapter({ port: 0, host: '127.0.0.1' });
  const extracted = extractTuiAdapter(gateway);
  assert.ok(extracted !== null);
  assert.equal(extracted, gateway);
});

test('extractTuiAdapter: returns null for non-TUI adapter', () => {
  const primary = new MockAdapter({ adminChannel: 'C-admin' });
  const extracted = extractTuiAdapter(primary);
  assert.equal(extracted, null);
});

// ── Test: FanOutOutputStream ──────────────────────────────────────

test('FanOutOutputStream: broadcasts emitText to all sub-streams', () => {
  const sub1 = new RecordingOutputStream();
  const sub2 = new RecordingOutputStream();
  const fanOut = new FanOutOutputStream([sub1, sub2]);

  fanOut.emitText('hello');
  fanOut.emitText('world');

  assert.equal(sub1.segments.length, 2);
  assert.equal(sub1.segments[0], 'emit:hello');
  assert.equal(sub1.segments[1], 'emit:world');
  assert.equal(sub2.segments[0], 'emit:hello');
  assert.equal(sub2.segments[1], 'emit:world');
});

test('FanOutOutputStream: openMutable returns aggregate MutableRegion that fan-outs updates', () => {
  const sub1 = new RecordingOutputStream();
  const sub2 = new RecordingOutputStream();
  const fanOut = new FanOutOutputStream([sub1, sub2]);

  const region = fanOut.openMutable('start');
  region.update('revised');

  assert.equal(sub1.segments[0], 'mutable:start');
  assert.equal(sub2.segments[0], 'mutable:start');
  assert.equal(sub1.segments[1], 'update:revised');
  assert.equal(sub2.segments[1], 'update:revised');
});

test('FanOutOutputStream: postInteractive returns first non-null ref', async () => {
  const sub1 = new RecordingOutputStream();
  sub1.postInteractive = async () => null; // override to return null
  const sub2 = new RecordingOutputStream();

  const fanOut = new FanOutOutputStream([sub1, sub2]);
  const ref = await fanOut.postInteractive('test');

  assert.ok(ref !== null);
  assert.equal(ref!.messageId, '1');
  assert.equal(sub2.refs.length, 1);
});

test('FanOutOutputStream: flush awaits all sub-streams', async () => {
  const sub1 = new RecordingOutputStream();
  const sub2 = new RecordingOutputStream();
  const fanOut = new FanOutOutputStream([sub1, sub2]);

  await fanOut.flush();

  assert.equal(sub1.segments[0], 'flush');
  assert.equal(sub2.segments[0], 'flush');
});

test('FanOutOutputStream: getRefs concatenates all sub-stream refs', () => {
  const sub1 = new RecordingOutputStream();
  const sub2 = new RecordingOutputStream();

  // Both sub-streams have auto-created refs from postInteractive
  const fanOut = new FanOutOutputStream([sub1, sub2]);
  // Trigger ref creation by calling postInteractive
  fanOut.postInteractive('a');
  fanOut.postInteractive('b');

  const refs = fanOut.getRefs();
  assert.equal(refs.length, sub1.refs.length + sub2.refs.length);
});

test('FanOutOutputStream: getParentRef returns first sub-stream parent', () => {
  const sub1 = new RecordingOutputStream();
  const sub2 = new RecordingOutputStream();
  const fanOut = new FanOutOutputStream([sub1, sub2]);

  // No parent ref set yet
  assert.equal(fanOut.getParentRef(), null);

  // After postInteractive, parent refs are set on sub-streams
  fanOut.postInteractive('first');

  const parent = fanOut.getParentRef();
  assert.ok(parent !== null);
});
