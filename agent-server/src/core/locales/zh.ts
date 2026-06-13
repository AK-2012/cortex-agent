// input:  MessageKey from en.ts
// output: `zh` — Simplified-Chinese message table, typed Record<MessageKey, string>
// pos:    L0 locale data; the Record<MessageKey,...> type forces parity with en.ts at compile time
// >>> If I am updated, keep keys in lockstep with en.ts <<<

import type { MessageKey } from './en.js';

/** Simplified-Chinese translations. Must provide every MessageKey (compiler-enforced) and add
 *  none. ${param} placeholders and `code`/*bold* markdown are preserved verbatim from en.ts. */
export const zh: Record<MessageKey, string> = {
  // ── Language command ──────────────────────────────────────────────
  'lang.current': '当前语言：*${lang}*',
  'lang.switched': '已切换语言为 *${lang}*。',
  'lang.usage': '用法：`!lang <en|zh>`',
  'lang.available': '可用语言：`en`（English）、`zh`（中文）',
  'lang.unknown': '未知语言 `${lang}`。可用：`en`、`zh`。',
};
