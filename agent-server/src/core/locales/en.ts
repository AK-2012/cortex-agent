// input:  nothing (leaf data module)
// output: `en` — canonical English message table + MessageKey type (the keyset of record)
// pos:    L0 locale data; zh.ts must satisfy Record<MessageKey, string> (compile-time key parity)
// >>> If I am updated, update zh.ts to match, and the parent folder's CORTEX.md <<<

/** Canonical English message table. Keys are dot-namespaced by area (lang/cmd/status/...).
 *  Values may contain ${param} placeholders resolved by i18n.t(). Icons (core/icons.ts) are
 *  kept in code, NOT in these strings — only the human-readable text lives here. */
export const en = {
  // ── Language command ──────────────────────────────────────────────
  'lang.current': 'Current language: *${lang}*',
  'lang.switched': 'Language switched to *${lang}*.',
  'lang.usage': 'Usage: `!lang <en|zh>`',
  'lang.available': 'Available languages: `en` (English), `zh` (中文)',
  'lang.unknown': 'Unknown language `${lang}`. Available: `en`, `zh`.',
} as const;

/** The exact keyset every locale must provide. zh.ts is typed against this. */
export type MessageKey = keyof typeof en;
