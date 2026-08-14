import assert from 'node:assert/strict';
import test from 'node:test';
import { LANGUAGE_STORAGE_KEY, LOCALE_META, SUPPORTED_LOCALES, loadLocale, messageKeys, messagesFor, sanitizeLocale, saveLocale, translate } from '../src/i18n/i18n.mjs';

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key), keys: () => [...values.keys()] };
}

test('supports the five fixed UI locales and defaults to English', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['en', 'zh-CN', 'ms', 'ja', 'vi']);
  assert.equal(sanitizeLocale(undefined), 'en');
  assert.equal(sanitizeLocale('xx'), 'en');
  assert.equal(loadLocale(memoryStorage()), 'en');
  assert.equal(LOCALE_META.en.nativeLabel, 'English');
});

test('persists only the language preference', () => {
  const storage = memoryStorage();
  assert.equal(saveLocale('ja', storage), 'ja');
  assert.equal(storage.getItem(LANGUAGE_STORAGE_KEY), 'ja');
  assert.equal(loadLocale(storage), 'ja');
  assert.equal(saveLocale('not-a-locale', storage), 'en');
  assert.equal(loadLocale(storage), 'en');
});

test('interpolates translated UI messages without changing business values', () => {
  assert.equal(translate('viewer.page', { page: 5, total: 12 }, 'zh-CN'), '第 5 / 12 页');
  assert.equal(translate('result.lineItems', { count: 128 }, 'ms'), 'Item Baris (128 baris)');
  assert.equal(translate('viewer.page', { page: 1, total: 1 }, 'ja'), 'ページ 1 / 1');
  assert.equal(translate('missing.key', {}, 'vi'), 'missing.key');
});

test('every locale has the complete merged dictionary and locale data stays UI-only', () => {
  const keys = messageKeys();
  for (const locale of SUPPORTED_LOCALES) {
    const dictionary = messagesFor(locale);
    assert.deepEqual(Object.keys(dictionary).sort(), keys.slice().sort());
  }
  const storage = memoryStorage();
  saveLocale('vi', storage);
  assert.deepEqual(storage.keys(), [LANGUAGE_STORAGE_KEY]);
});
