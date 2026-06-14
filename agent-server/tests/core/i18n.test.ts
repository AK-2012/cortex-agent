// input:  Node test runner + core/i18n module + en/zh locales
// output: t() lookup / interpolation / fallback + setLocale/getLocale + en↔zh key parity
// pos:    Unit tests for the zero-dependency i18n layer (L0)
// >>> If I am updated, update my header comment and the parent folder's CORTEX.md <<<

import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { t, setLocale, getLocale, normalizeLocale } from '../../src/core/i18n.js';
import { en } from '../../src/core/locales/en.js';
import { zh } from '../../src/core/locales/zh.js';

describe('i18n', () => {
  afterEach(() => setLocale('en'));

  it('normalizeLocale maps known values and falls back to en', () => {
    assert.equal(normalizeLocale('zh'), 'zh');
    assert.equal(normalizeLocale('en'), 'en');
    assert.equal(normalizeLocale('fr'), 'en');
    assert.equal(normalizeLocale(undefined), 'en');
    assert.equal(normalizeLocale(''), 'en');
  });

  it('setLocale/getLocale round-trip', () => {
    setLocale('zh');
    assert.equal(getLocale(), 'zh');
    setLocale('en');
    assert.equal(getLocale(), 'en');
  });

  it('t returns the active-locale string', () => {
    setLocale('en');
    assert.equal(t('lang.current'), en['lang.current']);
    setLocale('zh');
    assert.equal(t('lang.current'), zh['lang.current']);
  });

  it('t interpolates ${param} placeholders', () => {
    setLocale('en');
    // lang.switched contains a ${lang} placeholder in both locales
    const out = t('lang.switched', { lang: 'zh' });
    assert.match(out, /zh/);
    assert.ok(!out.includes('${'), 'no unresolved placeholders');
  });

  it('t falls back to en when a key is absent in the active locale', () => {
    // Force a key that exists only in en by temporarily casting; runtime fallback path.
    setLocale('zh');
    const key = '__test.only_en__' as any;
    (en as any)[key] = 'english-only';
    try {
      assert.equal(t(key), 'english-only');
    } finally {
      delete (en as any)[key];
    }
  });

  it('t falls back to the raw key when unknown everywhere', () => {
    assert.equal(t('totally.unknown.key' as any), 'totally.unknown.key');
  });

  it('en and zh expose the exact same key set (parity)', () => {
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zh).sort();
    assert.deepEqual(zhKeys, enKeys, 'zh must translate every en key and add none');
  });

  it('every value is a non-empty string in both locales', () => {
    for (const [k, v] of Object.entries(en)) {
      assert.equal(typeof v, 'string', `en.${k} must be a string`);
      assert.ok((v as string).length >= 1, `en.${k} must not be empty`);
    }
    for (const [k, v] of Object.entries(zh)) {
      assert.equal(typeof v, 'string', `zh.${k} must be a string`);
      assert.ok((v as string).length >= 1, `zh.${k} must not be empty`);
    }
  });
});
