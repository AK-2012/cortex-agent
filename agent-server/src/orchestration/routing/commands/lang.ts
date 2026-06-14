// input:  core/i18n (t/setLocale/getLocale), domain/system/preferences (setLang)
// output: handleLangCmd — !lang [en|zh] show/switch handler
// pos:    !lang command. Persists to config/preferences.json AND switches the live locale
//         (no restart). Registered in commands/index.ts.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { Icons } from '../../../core/icons.js';
import { t, setLocale, getLocale, type Locale } from '../../../core/i18n.js';
import { setLang } from '@domain/system/preferences.js';
import type { PlatformAdapter } from '@platform/index.js';
import type { CommandResult } from './command-context.js';

/** Human labels for the confirmation text (shown regardless of active locale). */
const LANG_LABELS: Record<Locale, string> = { en: 'English', zh: '中文' };

export async function handleLangCmd(
  _channel: string,
  _adapter: PlatformAdapter,
  trimmedMessage: string,
): Promise<CommandResult> {
  const arg = (trimmedMessage.split(/\s+/)[1] || '').trim().toLowerCase();

  // No argument → show current language, the available set, and usage.
  if (!arg) {
    const cur = getLocale();
    return {
      text: [
        t('lang.current', { lang: LANG_LABELS[cur] }),
        t('lang.available'),
        t('lang.usage'),
      ].join('\n'),
    };
  }

  if (arg !== 'en' && arg !== 'zh') {
    return { text: `${Icons.error} ${t('lang.unknown', { lang: arg })}` };
  }

  const loc = arg as Locale;
  setLang(loc); // persist to preferences.json
  setLocale(loc); // live switch — subsequent t() calls render in the new locale
  return { text: `${Icons.ok} ${t('lang.switched', { lang: LANG_LABELS[loc] })}` };
}
