// input:  CONFIG_DIR constant, core/i18n normalizeLocale
// output: loadPreferences / loadLang / setLang for config/preferences.json
// pos:    operator-level display preferences (language, future UI prefs). Set-once + runtime
//         switchable via !lang. Separate from mode.json (LLM execution state) by design.
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_DIR } from '../../core/utils.js';
import { normalizeLocale, type Locale } from '../../core/i18n.js';

/** Operator display preferences. Extensible — language today, room for date/number formats etc. */
export interface Preferences {
  lang?: Locale;
}

// Mutable for test isolation — tests redirect this via _testSetPreferencesFile.
let prefsFilePath: string = path.join(CONFIG_DIR, 'preferences.json');

export function loadPreferences(): Preferences {
  try {
    const parsed = JSON.parse(fs.readFileSync(prefsFilePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Resolve the persisted UI language, defaulting to 'en'. */
export function loadLang(): Locale {
  return normalizeLocale(loadPreferences().lang);
}

/** Persist the UI language, preserving any other preference keys already on disk. */
export function setLang(loc: Locale): void {
  const normalized = normalizeLocale(loc);
  const current = loadPreferences();
  const next: Preferences = { ...current, lang: normalized };
  fs.mkdirSync(path.dirname(prefsFilePath), { recursive: true });
  fs.writeFileSync(prefsFilePath, JSON.stringify(next, null, 2) + '\n');
}

/** Test-only: redirect the preferences file to an isolated temp location. */
export function _testSetPreferencesFile(p: string): void {
  prefsFilePath = p;
}
