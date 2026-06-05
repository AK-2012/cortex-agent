// input:  node:test, markdownToBlocks
// output: Unit tests pinning markdown → Feishu docx block descriptor conversion
// pos:    TDD spec for the docx content authoring path (block-level + inline styles)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToBlocks } from '../src/domain/mcp/feishu/markdown-to-blocks.js';

// ── block-level ──────────────────────────────────────────────────────────

test('empty string → no blocks', () => {
  assert.deepEqual(markdownToBlocks(''), []);
  assert.deepEqual(markdownToBlocks('   \n  \n'), []);
});

test('plain paragraph → text block', () => {
  assert.deepEqual(markdownToBlocks('hello world'), [
    { block_type: 2, text: { elements: [{ text_run: { content: 'hello world' } }] } },
  ]);
});

test('ATX headings map to heading1..heading6', () => {
  assert.deepEqual(markdownToBlocks('# H1'), [
    { block_type: 3, heading1: { elements: [{ text_run: { content: 'H1' } }] } },
  ]);
  assert.deepEqual(markdownToBlocks('### H3'), [
    { block_type: 5, heading3: { elements: [{ text_run: { content: 'H3' } }] } },
  ]);
  assert.deepEqual(markdownToBlocks('###### H6'), [
    { block_type: 8, heading6: { elements: [{ text_run: { content: 'H6' } }] } },
  ]);
});

test('unordered list (- and *) → bullet blocks', () => {
  assert.deepEqual(markdownToBlocks('- a\n* b'), [
    { block_type: 12, bullet: { elements: [{ text_run: { content: 'a' } }] } },
    { block_type: 12, bullet: { elements: [{ text_run: { content: 'b' } }] } },
  ]);
});

test('ordered list → ordered blocks', () => {
  assert.deepEqual(markdownToBlocks('1. first\n2. second'), [
    { block_type: 13, ordered: { elements: [{ text_run: { content: 'first' } }] } },
    { block_type: 13, ordered: { elements: [{ text_run: { content: 'second' } }] } },
  ]);
});

test('task list → todo blocks with done style', () => {
  assert.deepEqual(markdownToBlocks('- [ ] open\n- [x] closed'), [
    { block_type: 17, todo: { elements: [{ text_run: { content: 'open' } }], style: { done: false } } },
    { block_type: 17, todo: { elements: [{ text_run: { content: 'closed' } }], style: { done: true } } },
  ]);
});

test('blockquote line → quote block', () => {
  assert.deepEqual(markdownToBlocks('> quoted'), [
    { block_type: 15, quote: { elements: [{ text_run: { content: 'quoted' } }] } },
  ]);
});

test('thematic break → divider block', () => {
  assert.deepEqual(markdownToBlocks('---'), [{ block_type: 22, divider: {} }]);
  assert.deepEqual(markdownToBlocks('***'), [{ block_type: 22, divider: {} }]);
});

test('fenced code block → single code block preserving newlines + language', () => {
  const md = '```python\nx = 1\nprint(x)\n```';
  assert.deepEqual(markdownToBlocks(md), [
    {
      block_type: 14,
      code: {
        elements: [{ text_run: { content: 'x = 1\nprint(x)' } }],
        style: { language: 49, wrap: true },
      },
    },
  ]);
});

test('fenced code with unknown / no language → plaintext (1)', () => {
  const md = '```\nraw\n```';
  assert.deepEqual(markdownToBlocks(md), [
    { block_type: 14, code: { elements: [{ text_run: { content: 'raw' } }], style: { language: 1, wrap: true } } },
  ]);
});

test('blank lines separate blocks and are skipped', () => {
  assert.deepEqual(markdownToBlocks('# Title\n\npara'), [
    { block_type: 3, heading1: { elements: [{ text_run: { content: 'Title' } }] } },
    { block_type: 2, text: { elements: [{ text_run: { content: 'para' } }] } },
  ]);
});

// ── inline styles ────────────────────────────────────────────────────────

test('bold inline → text_element_style.bold, splitting runs', () => {
  assert.deepEqual(markdownToBlocks('Hello **world**'), [
    {
      block_type: 2,
      text: {
        elements: [
          { text_run: { content: 'Hello ' } },
          { text_run: { content: 'world', text_element_style: { bold: true } } },
        ],
      },
    },
  ]);
});

test('italic, strikethrough, inline code', () => {
  assert.deepEqual(markdownToBlocks('*i* ~~s~~ `c`'), [
    {
      block_type: 2,
      text: {
        elements: [
          { text_run: { content: 'i', text_element_style: { italic: true } } },
          { text_run: { content: ' ' } },
          { text_run: { content: 's', text_element_style: { strikethrough: true } } },
          { text_run: { content: ' ' } },
          { text_run: { content: 'c', text_element_style: { inline_code: true } } },
        ],
      },
    },
  ]);
});

test('link inline → text_element_style.link.url', () => {
  assert.deepEqual(markdownToBlocks('see [docs](https://x.io)'), [
    {
      block_type: 2,
      text: {
        elements: [
          { text_run: { content: 'see ' } },
          { text_run: { content: 'docs', text_element_style: { link: { url: 'https://x.io' } } } },
        ],
      },
    },
  ]);
});

test('inline code content is not re-parsed for other markers', () => {
  assert.deepEqual(markdownToBlocks('`**not bold**`'), [
    {
      block_type: 2,
      text: { elements: [{ text_run: { content: '**not bold**', text_element_style: { inline_code: true } } }] },
    },
  ]);
});

test('escaped asterisk is literal, not emphasis', () => {
  assert.deepEqual(markdownToBlocks('a \\* b'), [
    { block_type: 2, text: { elements: [{ text_run: { content: 'a * b' } }] } },
  ]);
});

test('heading content carries inline styles', () => {
  assert.deepEqual(markdownToBlocks('# Hello **bold**'), [
    {
      block_type: 3,
      heading1: {
        elements: [
          { text_run: { content: 'Hello ' } },
          { text_run: { content: 'bold', text_element_style: { bold: true } } },
        ],
      },
    },
  ]);
});
