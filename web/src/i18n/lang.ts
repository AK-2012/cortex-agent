import { en, zh, type Vocab } from './vocab';

export type Lang = 'en' | 'zh';

// Mobile / desktop boundary. Matches Tailwind's default `md` breakpoint:
// width <= 767 is mobile (→ zh); >= 768 is desktop (→ en).
export const MOBILE_MAX_WIDTH = 767;

export function deriveLang(viewportWidth: number): Lang {
  return viewportWidth <= MOBILE_MAX_WIDTH ? 'zh' : 'en';
}

export function pickVocab(lang: Lang): Vocab {
  return lang === 'zh' ? zh : en;
}
