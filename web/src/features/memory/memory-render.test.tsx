import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownView } from './MarkdownView';

// react-dom/server render checks for the memory viewer 7b presentational surface. vitest
// runs in node; data fetching + the diff toggle + tree selection live in MemoryView (verified against
// a real ui-http-server, not here). Fixtures use neutral placeholder content (no private project data).

describe('MarkdownView', () => {
  it('renders a frontmatter card with chip keys and a summary line', () => {
    const src = '---\nid: NIMBUS-1\nstatus: active\nsummary: a neutral one-liner\n---\n# Title\n\nbody text';
    const html = renderToStaticMarkup(<MarkdownView content={src} />);
    expect(html).toContain('NIMBUS-1');
    expect(html).toContain('active');
    expect(html).toContain('summary');
    expect(html).toContain('a neutral one-liner');
    expect(html).toContain('Title');
  });

  it('renders headings, paragraphs and bullet lists', () => {
    const src = '# Background\n\nSome prose here.\n\n- first point\n- second point';
    const html = renderToStaticMarkup(<MarkdownView content={src} />);
    expect(html).toContain('Background');
    expect(html).toContain('Some prose here.');
    expect(html).toContain('first point');
    expect(html).toContain('·'); // bullet glyph
  });

  it('renders a GFM table with header and rows', () => {
    const src = '| Config | Success |\n| --- | --- |\n| alpha | 76% |\n| beta | 81% |';
    const html = renderToStaticMarkup(<MarkdownView content={src} />);
    expect(html).toContain('Config');
    expect(html).toContain('Success');
    expect(html).toContain('alpha');
    expect(html).toContain('81%');
    expect(html).toContain('display:grid');
  });

  it('renders inline code and links', () => {
    const src = 'use `cortex-run` and see [docs](https://example.com)';
    const html = renderToStaticMarkup(<MarkdownView content={src} />);
    expect(html).toContain('cortex-run');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('docs');
  });

  it('omits the frontmatter card when the file has none', () => {
    const html = renderToStaticMarkup(<MarkdownView content={'plain body, no frontmatter'} />);
    expect(html).toContain('plain body, no frontmatter');
    expect(html).not.toContain('summary');
  });
});
