// input:  none (pure constants)
// output: Feishu docx BlockType numeric enum + code-language enum + style color maps
// pos:    Shared constants for markdown→block conversion and block rendering
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

/**
 * Feishu docx `block_type` numeric enum.
 *
 * The @larksuiteoapi/node-sdk types declare `block_type: number` without the
 * enum values, but the API requires the exact integer. Values verified against
 * the official Feishu docx block data-structure documentation.
 *
 * Only the subset reachable from markdown conversion is enumerated here; the
 * full Feishu enum has 30+ types (table, image, grid, …) reachable via the
 * raw `blocks` escape hatch.
 */
export const BlockType = {
  Page: 1,
  Text: 2,
  Heading1: 3,
  Heading2: 4,
  Heading3: 5,
  Heading4: 6,
  Heading5: 7,
  Heading6: 8,
  Heading7: 9,
  Heading8: 10,
  Heading9: 11,
  Bullet: 12,
  Ordered: 13,
  Code: 14,
  Quote: 15,
  Todo: 17,
  Callout: 19,
  Divider: 22,
} as const;

export type BlockTypeName = keyof typeof BlockType;

/** The block-content key that pairs with each block_type in a block descriptor. */
export const BLOCK_TYPE_KEY: Record<number, string> = {
  [BlockType.Text]: 'text',
  [BlockType.Heading1]: 'heading1',
  [BlockType.Heading2]: 'heading2',
  [BlockType.Heading3]: 'heading3',
  [BlockType.Heading4]: 'heading4',
  [BlockType.Heading5]: 'heading5',
  [BlockType.Heading6]: 'heading6',
  [BlockType.Heading7]: 'heading7',
  [BlockType.Heading8]: 'heading8',
  [BlockType.Heading9]: 'heading9',
  [BlockType.Bullet]: 'bullet',
  [BlockType.Ordered]: 'ordered',
  [BlockType.Code]: 'code',
  [BlockType.Quote]: 'quote',
  [BlockType.Todo]: 'todo',
  [BlockType.Callout]: 'callout',
  [BlockType.Divider]: 'divider',
};

/** Map a markdown ATX heading level (1-9) to its BlockType value. */
export function headingBlockType(level: number): number {
  const clamped = Math.min(Math.max(level, 1), 9);
  return BlockType.Heading1 + (clamped - 1);
}

/**
 * Feishu code block `style.language` numeric enum (subset of common languages).
 * The API accepts an integer; 1 = PlainText is the safe default for unknown
 * fences. Verified against the Feishu docx code-block language enum.
 */
export const CodeLanguage: Record<string, number> = {
  plaintext: 1,
  abap: 2,
  ada: 3,
  apache: 4,
  apex: 5,
  assembly: 6,
  bash: 7,
  sh: 7,
  shell: 7,
  csharp: 8,
  'c#': 8,
  cpp: 9,
  'c++': 9,
  c: 10,
  css: 12,
  diff: 14,
  dockerfile: 16,
  go: 20,
  golang: 20,
  graphql: 21,
  groovy: 22,
  html: 23,
  json: 28,
  java: 25,
  javascript: 26,
  js: 26,
  kotlin: 30,
  latex: 31,
  lua: 33,
  makefile: 34,
  markdown: 35,
  md: 35,
  matlab: 36,
  nginx: 39,
  'objective-c': 40,
  php: 43,
  python: 49,
  py: 49,
  r: 50,
  ruby: 52,
  rb: 52,
  rust: 53,
  rs: 53,
  scala: 54,
  scss: 56,
  sql: 60,
  swift: 64,
  toml: 67,
  typescript: 68,
  ts: 68,
  vue: 72,
  xml: 73,
  yaml: 74,
  yml: 74,
} as const;

/** Resolve a markdown code-fence language hint to its Feishu language code. */
export function codeLanguageCode(hint?: string): number {
  if (!hint) return CodeLanguage.plaintext;
  return CodeLanguage[hint.trim().toLowerCase()] ?? CodeLanguage.plaintext;
}
