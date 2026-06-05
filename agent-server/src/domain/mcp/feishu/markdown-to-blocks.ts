// input:  block-types (BlockType enum, key map, language map)
// output: markdownToBlocks(md) → Feishu docx block descriptor[] (block-level + inline styles)
// pos:    Content authoring path for feishu_docx_* tools — shields agents from raw block JSON
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { BlockType, BLOCK_TYPE_KEY, headingBlockType, codeLanguageCode } from './block-types.js';

/** Inline text style flags mirroring Feishu `text_element_style`. */
export interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  inline_code?: boolean;
  link?: { url: string };
}

/** A Feishu inline element (text_run only — mentions/equations go via the blocks escape hatch). */
export interface TextElement {
  text_run: { content: string; text_element_style?: InlineStyle };
}

/** A Feishu docx block descriptor accepted by documentBlockChildren.create. */
export interface BlockDescriptor {
  block_type: number;
  [key: string]: unknown;
}

function mergeStyle(base: InlineStyle, add: InlineStyle): InlineStyle {
  return { ...base, ...add };
}

function makeRun(content: string, style: InlineStyle): TextElement {
  if (Object.keys(style).length === 0) {
    return { text_run: { content } };
  }
  return { text_run: { content, text_element_style: style } };
}

/**
 * Parse a single line of inline markdown into Feishu text elements.
 * Handles (with escaping): `**bold**`, `*italic*` / `_italic_`, `~~strike~~`,
 * `` `code` ``, and `[label](url)`. Emphasis nests; inline code is opaque.
 */
export function parseInline(text: string, base: InlineStyle = {}): TextElement[] {
  const out: TextElement[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push(makeRun(buf, base));
      buf = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];

    // Backslash escape — next char is literal.
    if (c === '\\' && i + 1 < text.length) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    // Inline code — opaque, not re-parsed.
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        out.push(makeRun(text.slice(i + 1, end), mergeStyle(base, { inline_code: true })));
        i = end + 1;
        continue;
      }
    }

    // Link [label](url).
    if (c === '[') {
      const close = text.indexOf(']', i + 1);
      if (close !== -1 && text[close + 1] === '(') {
        const paren = text.indexOf(')', close + 2);
        if (paren !== -1) {
          flush();
          const label = text.slice(i + 1, close);
          const url = text.slice(close + 2, paren);
          out.push(...parseInline(label, mergeStyle(base, { link: { url } })));
          i = paren + 1;
          continue;
        }
      }
    }

    // Strong **…**.
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        flush();
        out.push(...parseInline(text.slice(i + 2, end), mergeStyle(base, { bold: true })));
        i = end + 2;
        continue;
      }
    }

    // Strikethrough ~~…~~.
    if (text.startsWith('~~', i)) {
      const end = text.indexOf('~~', i + 2);
      if (end !== -1) {
        flush();
        out.push(...parseInline(text.slice(i + 2, end), mergeStyle(base, { strikethrough: true })));
        i = end + 2;
        continue;
      }
    }

    // Emphasis *…* or _…_.
    if (c === '*' || c === '_') {
      const end = text.indexOf(c, i + 1);
      if (end > i + 1) {
        flush();
        out.push(...parseInline(text.slice(i + 1, end), mergeStyle(base, { italic: true })));
        i = end + 1;
        continue;
      }
    }

    buf += c;
    i++;
  }

  flush();
  return out;
}

function block(blockType: number, payload: Record<string, unknown>): BlockDescriptor {
  return { block_type: blockType, [BLOCK_TYPE_KEY[blockType]]: payload };
}

/**
 * Convert markdown into a flat list of Feishu docx block descriptors.
 *
 * Block-level (one markdown line = one block, except fenced code which spans
 * lines): ATX headings `#`–`######` → heading1-6, `-`/`*` → bullet, `1.` →
 * ordered, `- [ ]`/`- [x]` → todo, ```` ``` ```` fences → code (with language),
 * `>` → quote, `---`/`***`/`___` → divider, everything else → text paragraph.
 *
 * Nesting (multi-level lists, callouts) and Feishu-only blocks (tables, images,
 * colors, mentions) are out of scope here — use the raw `blocks` escape hatch.
 */
export function markdownToBlocks(md: string): BlockDescriptor[] {
  const lines = md.split('\n');
  const blocks: BlockDescriptor[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();
    const trimmed = line.trim();

    // Fenced code block — consume until closing fence.
    const fence = trimmed.match(/^```(.*)$/);
    if (fence) {
      const lang = fence[1].trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        block(BlockType.Code, {
          elements: [{ text_run: { content: codeLines.join('\n') } }],
          style: { language: codeLanguageCode(lang), wrap: true },
        }),
      );
      continue;
    }

    if (!trimmed) {
      i++;
      continue;
    }

    // Thematic break.
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ block_type: BlockType.Divider, divider: {} });
      i++;
      continue;
    }

    // ATX heading.
    const heading = trimmed.match(/^(#{1,9})\s+(.*)$/);
    if (heading) {
      const bt = headingBlockType(heading[1].length);
      blocks.push(block(bt, { elements: parseInline(heading[2].trim()) }));
      i++;
      continue;
    }

    // Task list item (before generic bullet).
    const todo = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (todo) {
      blocks.push(
        block(BlockType.Todo, {
          elements: parseInline(todo[2].trim()),
          style: { done: todo[1].toLowerCase() === 'x' },
        }),
      );
      i++;
      continue;
    }

    // Unordered list item.
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      blocks.push(block(BlockType.Bullet, { elements: parseInline(bullet[1].trim()) }));
      i++;
      continue;
    }

    // Ordered list item.
    const ordered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      blocks.push(block(BlockType.Ordered, { elements: parseInline(ordered[1].trim()) }));
      i++;
      continue;
    }

    // Blockquote line.
    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push(block(BlockType.Quote, { elements: parseInline(quote[1].trim()) }));
      i++;
      continue;
    }

    // Default: paragraph text.
    blocks.push(block(BlockType.Text, { elements: parseInline(trimmed) }));
    i++;
  }

  return blocks;
}
