// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveLang, translator, loadI18n } from '../assets/crek-i18n.mjs';

const dict = loadI18n();

test('every dictionary has every English key', () => {
  for (const [code, d] of Object.entries(dict)) {
    const missing = Object.keys(dict.en).filter((k) => !(k in d));
    assert.deepEqual(missing, [], `${code} lacks ${missing.join(', ')}`);
  }
});

test('index.php carries an exact copy of i18n.json', () => {
  const php = readFileSync(fileURLToPath(new URL('../assets/crek-php/index.php', import.meta.url)), 'utf8');
  const inline = php.split("json_decode(<<<'JSON'\n")[1].split('\nJSON, true);')[0];
  const json = readFileSync(fileURLToPath(new URL('../assets/i18n.json', import.meta.url)), 'utf8').replace(/\n$/, '');
  assert.equal(inline, json, 'paste assets/i18n.json into index.php');
});

test('resolveLang: codes, regions, names; no value = Polish, unknown = English', () => {
  assert.equal(resolveLang('pl'), 'pl');
  assert.equal(resolveLang('en-GB'), 'en');
  assert.equal(resolveLang('Polish'), 'pl');
  assert.equal(resolveLang('polski'), 'pl');
  assert.equal(resolveLang('angielski'), 'en');
  assert.equal(resolveLang(undefined), 'pl');
  assert.equal(resolveLang(''), 'pl');
  assert.equal(resolveLang('Ukrainian'), 'en');
});

test('translator fills placeholders and falls back to English, then to the key', () => {
  const t = translator('pl');
  assert.equal(t('note.closed', { checked: '30.10 14:20' }), 'zamknięte — nie przyjmuje już zgłoszeń (sprawdzone 30.10 14:20)');
  assert.equal(translator('xx')('note.skipped'), 'skipped without review');
  assert.equal(t('no.such.key'), 'no.such.key');
});
