// Pure, dependency-free Markdown parsing for the memory viewer 7b. Renders the raw
// `memory.file` content string into the prototype's exact typographic structure (headings /
// paragraphs / lists / GFM tables / code / blockquote). Deliberately a small subset — the block/
// inline forms real project-memory files use — kept pure and TDD-tested so render correctness is
// governed by tests. No JSX here; MarkdownView maps these nodes to prototype-styled elements.

export interface FrontmatterEntry {
  key: string;
  value: string;
}

export interface Frontmatter {
  /** Non-`summary` key/value pairs, in file order — rendered as the card's chips. */
  entries: FrontmatterEntry[];
  /** The `summary` key value if present (rendered as the card's summary line), else null. */
  summary: string | null;
}

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string };

export type Block =
  | { type: 'heading'; level: number; inline: InlineNode[] }
  | { type: 'paragraph'; inline: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'code'; lang: string | null; text: string }
  | { type: 'table'; header: InlineNode[][]; rows: InlineNode[][][] }
  | { type: 'blockquote'; inline: InlineNode[] }
  | { type: 'hr' };

function stripQuotes(v: string): string {
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Splits a YAML `--- … ---` frontmatter fence off the top of a Markdown file. Returns null
 * frontmatter (and the untouched source as body) when there is no well-formed leading fence.
 * Only top-level `key: value` lines are parsed (the memory card renders flat chips); the `summary`
 * key is surfaced separately.
 */
export function splitFrontmatter(content: string): { frontmatter: Frontmatter | null; body: string } {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { frontmatter: null, body: content };

  const rest = normalized.slice(4);
  const closeIdx = rest.search(/\n---[ \t]*(\n|$)/);
  if (closeIdx === -1) return { frontmatter: null, body: content };

  const yaml = rest.slice(0, closeIdx);
  const afterClose = rest.slice(closeIdx + 1); // includes the "---" line
  const bodyStart = afterClose.indexOf('\n');
  const body = bodyStart === -1 ? '' : afterClose.slice(bodyStart + 1);

  const entries: FrontmatterEntry[] = [];
  let summary: string | null = null;
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const m = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = stripQuotes(m[2].trim());
    if (key === 'summary') {
      summary = value;
      continue;
    }
    entries.push({ key, value });
  }
  return { frontmatter: { entries, summary }, body };
}

const INLINE_RE = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(\*([^*]+)\*)|(_([^_]+)_)/;

/** Tokenizes a line into non-nesting inline spans: bold / italic / code / link / plain text. */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let rest = text;
  while (rest.length) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      nodes.push({ type: 'text', text: rest });
      break;
    }
    if (m.index > 0) nodes.push({ type: 'text', text: rest.slice(0, m.index) });
    if (m[2] != null) nodes.push({ type: 'bold', text: m[2] });
    else if (m[4] != null) nodes.push({ type: 'code', text: m[4] });
    else if (m[6] != null) nodes.push({ type: 'link', text: m[6], href: m[7] });
    else if (m[9] != null) nodes.push({ type: 'italic', text: m[9] });
    else if (m[11] != null) nodes.push({ type: 'italic', text: m[11] });
    rest = rest.slice(m.index + m[0].length);
  }
  return nodes.length ? nodes : [{ type: 'text', text: '' }];
}

function splitCells(row: string): string[] {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

/** Parses a Markdown body (frontmatter already stripped) into block nodes. */
export function parseBlocks(body: string): Block[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  const isListLine = (l: string) => /^\s*([-*+]|\d+\.)\s+/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // fenced code
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || null;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      blocks.push({ type: 'code', lang, text: buf.join('\n') });
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, inline: parseInline(h[2].trim()) });
      i++;
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // GFM table: current line has a pipe and the next line is a separator
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitCells(line).map(parseInline);
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitCells(lines[i]).map(parseInline));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    // blockquote (consecutive `>` lines joined)
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', inline: parseInline(buf.join(' ').trim()) });
      continue;
    }

    // list (consecutive item lines)
    if (isListLine(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: InlineNode[][] = [];
      while (i < lines.length && isListLine(lines[i])) {
        const text = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        items.push(parseInline(text.trim()));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // paragraph (consecutive plain lines)
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !isListLine(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      buf.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'paragraph', inline: parseInline(buf.join(' ')) });
  }

  return blocks;
}
