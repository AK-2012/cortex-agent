// input:  node:test, status-helpers, MockAdapter
// output: writeStatus/sealStatus serialization and final-state sealing tests
// pos:    status-message serializer regression test
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeStatus, sealStatus } from '../src/orchestration/status-helpers.js';
import { MockAdapter } from '../src/platform/testing.js';

// --- Basic serialization ---

test('writeStatus: serialized writes land on adapter in call order', async () => {
  const adapter = new MockAdapter();
  const ref = { conduit: 'C1', messageId: 'M1' };

  // Awaiting the returned promises drains the chain deterministically.
  await writeStatus(adapter, ref, 'one');
  await writeStatus(adapter, ref, 'two');
  await writeStatus(adapter, ref, 'three');

  assert.deepEqual(
    adapter.updated.map(u => u.content.text),
    ['one', 'two', 'three'],
  );
});

// --- The actual race-fix invariant ---

test('sealStatus: final text is the last write (in-flight progress cannot overwrite it)', async () => {
  const adapter = new MockAdapter();
  const ref = { conduit: 'C1', messageId: 'M1' };

  // Simulate the production flow: many progress writes fire-and-forget, then
  // seal with the final "done" text.
  writeStatus(adapter, ref, 'processing-1');
  writeStatus(adapter, ref, 'processing-2');
  writeStatus(adapter, ref, 'processing-3');
  await sealStatus(adapter, ref, 'done');

  const texts = adapter.updated.map(u => u.content.text);
  assert.equal(texts[texts.length - 1], 'done', 'last update on Slack is "done"');
  assert.equal(texts.filter(t => t === 'done').length, 1, '"done" written exactly once');
});

test('sealStatus: writeStatus issued after seal is dropped — the key race fix', async () => {
  const adapter = new MockAdapter();
  const ref = { conduit: 'C2', messageId: 'M2' };

  // Agent completes → seal writes "done".
  await sealStatus(adapter, ref, 'done');

  // Late onProgress tick arrives after seal. Without the fix this would
  // overwrite "done" with "late-processing".
  const late = writeStatus(adapter, ref, 'late-processing');
  await late;

  const texts = adapter.updated.map(u => u.content.text);
  assert.deepEqual(texts, ['done'], 'late progress write is dropped');
});

test('sealStatus: awaits pending chain before writing final (no truncated race)', async () => {
  const adapter = new MockAdapter();
  const ref = { conduit: 'C3', messageId: 'M3' };

  // Fire many writes, then seal without awaiting them individually.
  writeStatus(adapter, ref, 'p1');
  writeStatus(adapter, ref, 'p2');
  writeStatus(adapter, ref, 'p3');
  await sealStatus(adapter, ref, 'done');

  // After sealStatus resolves, no further writes are in-flight — every
  // future writeStatus is silently dropped.
  const stillDropped = writeStatus(adapter, ref, 'ghost');
  await stillDropped;

  const texts = adapter.updated.map(u => u.content.text);
  assert.equal(texts[texts.length - 1], 'done');
  assert.equal(texts.filter(t => t === 'ghost').length, 0);
});

// --- Cross-message isolation ---

test('sealing one statusMsg does not block writes to a different statusMsg', async () => {
  const adapter = new MockAdapter();
  const refA = { conduit: 'C1', messageId: 'A' };
  const refB = { conduit: 'C1', messageId: 'B' };

  await sealStatus(adapter, refA, 'A done');
  await writeStatus(adapter, refB, 'B processing');

  const byRef = adapter.updated.map(u => ({ id: u.ref.messageId, text: u.content.text }));
  assert.deepEqual(byRef, [
    { id: 'A', text: 'A done' },
    { id: 'B', text: 'B processing' },
  ]);
});

// --- Error resilience ---

test('writeStatus: a failed update does not break the chain for subsequent writes', async () => {
  const adapter = new MockAdapter();
  adapter.failUpdateMessageCount = 1; // first updateMessage throws
  const ref = { conduit: 'C4', messageId: 'M4' };

  const first = writeStatus(adapter, ref, 'will-fail');
  const second = writeStatus(adapter, ref, 'should-still-run');
  await first;
  await second;

  // First call threw (not recorded in adapter.updated); second call recorded.
  assert.deepEqual(
    adapter.updated.map(u => u.content.text),
    ['should-still-run'],
  );
});

test('sealStatus: in-flight failed progress write does not block final write', async () => {
  const adapter = new MockAdapter();
  adapter.failUpdateMessageCount = 1;
  const ref = { conduit: 'C5', messageId: 'M5' };

  // Let the failing write actually fire (and its error be caught internally)
  // before sealing, so the fault counter is consumed by the progress write.
  await writeStatus(adapter, ref, 'this-will-fail');
  await sealStatus(adapter, ref, 'done');

  const texts = adapter.updated.map(u => u.content.text);
  assert.deepEqual(texts, ['done'], 'failed progress write leaves no trace; final "done" lands');
});
