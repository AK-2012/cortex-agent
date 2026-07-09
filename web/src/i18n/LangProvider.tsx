import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { deriveLang, pickVocab, MOBILE_MAX_WIDTH, type Lang } from './lang';
import { type Vocab } from './vocab';

interface LangContextValue {
  lang: Lang;
  vocab: Vocab;
  isMobile: boolean;
}

const LangContext = createContext<LangContextValue | null>(null);

const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

function currentLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  return deriveLang(window.innerWidth);
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(currentLang);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = () => setLang(mql.matches ? 'zh' : 'en');
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  // The mobile boundary is the same breakpoint that drives the language (mobile → zh), so it is the
  // single source of truth for both the vocabulary and the mobile/desktop render switch.
  const value = useMemo<LangContextValue>(
    () => ({ lang, vocab: pickVocab(lang), isMobile: lang === 'zh' }),
    [lang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within <LangProvider>');
  return ctx.lang;
}

// The vocabulary accessor — mirrors the prototype's `const L = this.dict()` idiom.
export function useVocab(): Vocab {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useVocab must be used within <LangProvider>');
  return ctx.vocab;
}

// True on a mobile viewport (≤ MOBILE_MAX_WIDTH). Drives the mobile/desktop render switch; tracks
// the same matchMedia listener as the language, so lang and layout never disagree.
export function useIsMobile(): boolean {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useIsMobile must be used within <LangProvider>');
  return ctx.isMobile;
}
