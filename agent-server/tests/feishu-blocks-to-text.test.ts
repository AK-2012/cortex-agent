// input:  node:test, blockToText, summarizeBlocks
// output: Unit tests for rendering Feishu API blocks → plain text + summaries
// pos:    TDD spec for feishu_docx_list_blocks / get_content rendering
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { blockToText, summarizeBlocks } from '../src/domain/mcp/feishu/blocks-to-text.js';

test('blockToText joins text_run contents of a text block', () => {
  const b = { block_type: 2, text: { elements: [{ text_run: { content: 'Hello ' } }, { text_run: { content: 'world' } }] } };
  assert.equal(blockToText(b), 'Hello world');
});

test('blockToText reads heading content', () => {
  const b = { block_type: 3, heading1: { elements: [{ text_run: { content: 'Title' } }] } };
  assert.equal(blockToText(b), 'Title');
});

test('blockToText returns empty string for divider / page', () => {
  assert.equal(blockToText({ block_type: 22, divider: {} }), '');
  assert.equal(blockToText({ block_type: 1 }), '');
});

test('summarizeBlocks maps block_id, type name, text, parent', () => {
  const blocks = [
    { block_id: 'p', block_type: 1 },
    { block_id: 'h', parent_id: 'p', block_type: 3, heading1: { elements: [{ text_run: { content: 'T' } }] } },
    { block_id: 't', parent_id: 'p', block_type: 2, text: { elements: [{ text_run: { content: 'body' } }] } },
  ];
  assert.deepEqual(summarizeBlocks(blocks), [
    { block_id: 'p', type: 'page', parent_id: undefined, text: '' },
    { block_id: 'h', type: 'heading1', parent_id: 'p', text: 'T' },
    { block_id: 't', type: 'text', parent_id: 'p', text: 'body' },
  ]);
});

test('summarizeBlocks tolerates unknown block types', () => {
  const out = summarizeBlocks([{ block_id: 'x', block_type: 999 }]);
  assert.equal(out[0].type, 'unknown(999)');
  assert.equal(out[0].text, '');
});
