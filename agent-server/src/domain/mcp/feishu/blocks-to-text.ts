// input:  block-types (BlockType enum, key map)
// output: blockToText / summarizeBlocks — render Feishu API blocks to text + summaries
// pos:    Read/locate path for feishu_docx_list_blocks & get_content
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { BlockType, BLOCK_TYPE_KEY } from './block-types.js';

const TYPE_NAME: Record<number, string> = {
  [BlockType.Page]: 'page',
  ...Object.fromEntries(Object.entries(BLOCK_TYPE_KEY).map(([n, key]) => [Number(n), key])),
};

/** Human-readable name for a block_type value (e.g. 3 → "heading1"). */
export function blockTypeName(blockType: number): string {
  return TYPE_NAME[blockType] ?? `unknown(${blockType})`;
}

interface ApiBlock {
  block_id?: string;
  parent_id?: string;
  block_type: number;
  [key: string]: unknown;
}

/** Extract the concatenated plain text from a Feishu API block's elements. */
export function blockToText(blockData: ApiBlock): string {
  const key = BLOCK_TYPE_KEY[blockData.block_type];
  if (!key) return '';
  const content = blockData[key] as { elements?: Array<Record<string, { content?: string }>> } | undefined;
  const elements = content?.elements;
  if (!Array.isArray(elements)) return '';
  let text = '';
  for (const el of elements) {
    // text_run / mention_user / mention_doc / equation all carry a text-ish payload;
    // we only surface the literal `content` field where present.
    for (const v of Object.values(el)) {
      if (v && typeof v === 'object' && typeof (v as { content?: string }).content === 'string') {
        text += (v as { content: string }).content;
      }
    }
  }
  return text;
}

export interface BlockSummary {
  block_id: string | undefined;
  type: string;
  parent_id: string | undefined;
  text: string;
}

/** Condense a list of API blocks into id/type/parent/text rows for agent navigation. */
export function summarizeBlocks(blocks: ApiBlock[]): BlockSummary[] {
  return blocks.map((b) => ({
    block_id: b.block_id,
    type: blockTypeName(b.block_type),
    parent_id: b.parent_id,
    text: blockToText(b),
  }));
}
