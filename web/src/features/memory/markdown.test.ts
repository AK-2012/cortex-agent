import { describe, it, expect } from 'vitest';
import { splitFrontmatter, parseInline, parseBlocks } from './markdown';

describe('splitFrontmatter', () => {
  it('returns null frontmatter when the file has no leading fence', () => {
    const { frontmatter, body } = splitFrontmatter('# Title\n\nhello');
    expect(frontmatter).toBeNull();
    expect(body).toBe('# Title\n\nhello');
  });

  it('extracts key/value entries and the body after the closing fence', () => {
    const src = '---\nid: NIMBUS-1\ndate: 2026-07-04\nstatus: active\n---\n# Title\n\nbody line';
    const { frontmatter, body } = splitFrontmatter(src);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter!.entries).toEqual([
      { key: 'id', value: 'NIMBUS-1' },
      { key: 'date', value: '2026-07-04' },
      { key: 'status', value: 'active' },
    ]);
    expect(body).toBe('# Title\n\nbody line');
  });

  it('pulls a summary key out of the chip entries', () => {
    const src = '---\nid: A\nsummary: a short line\n---\ntext';
    const { frontmatter } = splitFrontmatter(src);
    expect(frontmatter!.summary).toBe('a short line');
    expect(frontmatter!.entries.map((e) => e.key)).toEqual(['id']);
  });

  it('handles CRLF and quoted values', () => {
    const src = '---\r\nid: "quoted"\r\n---\r\nbody';
    const { frontmatter, body } = splitFrontmatter(src);
    expect(frontmatter!.entries).toEqual([{ key: 'id', value: 'quoted' }]);
    expect(body).toBe('body');
  });

  it('treats an unterminated fence as no frontmatter', () => {
    const src = '---\nid: A\nno closing fence';
    const { frontmatter, body } = splitFrontmatter(src);
    expect(frontmatter).toBeNull();
    expect(body).toBe(src);
  });
});

describe('parseInline', () => {
  it('returns a single text node for plain text', () => {
    expect(parseInline('just text')).toEqual([{ type: 'text', text: 'just text' }]);
  });

  it('parses bold, italic, code and links as spans', () => {
    expect(parseInline('a **b** c')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', text: 'b' },
      { type: 'text', text: ' c' },
    ]);
    expect(parseInline('use `code` here')).toEqual([
      { type: 'text', text: 'use ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: ' here' },
    ]);
    expect(parseInline('see [docs](https://x.y)')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', text: 'docs', href: 'https://x.y' },
    ]);
    expect(parseInline('_em_')).toEqual([{ type: 'italic', text: 'em' }]);
  });
});

describe('parseBlocks', () => {
  it('parses headings with levels', () => {
    const blocks = parseBlocks('# H1\n## H2');
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ type: 'heading', level: 2 });
    expect((blocks[0] as any).inline).toEqual([{ type: 'text', text: 'H1' }]);
  });

  it('joins consecutive non-blank lines into a paragraph', () => {
    const blocks = parseBlocks('line one\nline two\n\nnext para');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
    expect((blocks[0] as any).inline).toEqual([{ type: 'text', text: 'line one line two' }]);
  });

  it('parses unordered and ordered lists', () => {
    const ul = parseBlocks('- a\n- b');
    expect(ul[0]).toMatchObject({ type: 'list', ordered: false });
    expect((ul[0] as any).items).toHaveLength(2);
    const ol = parseBlocks('1. first\n2. second');
    expect(ol[0]).toMatchObject({ type: 'list', ordered: true });
  });

  it('parses a GFM pipe table with a separator row', () => {
    const src = '| Config | Success |\n| --- | --- |\n| a | 76% |\n| b | 81% |';
    const blocks = parseBlocks(src);
    expect(blocks).toHaveLength(1);
    const t = blocks[0] as any;
    expect(t.type).toBe('table');
    expect(t.header.map((c: any[]) => c[0].text)).toEqual(['Config', 'Success']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0][1][0].text).toBe('76%');
  });

  it('parses a fenced code block and keeps its text verbatim', () => {
    const src = '```ts\nconst x = 1;\n```';
    const blocks = parseBlocks(src);
    expect(blocks[0]).toMatchObject({ type: 'code', lang: 'ts', text: 'const x = 1;' });
  });

  it('parses a blockquote and a horizontal rule', () => {
    const blocks = parseBlocks('> quoted\n\n---');
    expect(blocks[0]).toMatchObject({ type: 'blockquote' });
    expect(blocks[1]).toMatchObject({ type: 'hr' });
  });
});
