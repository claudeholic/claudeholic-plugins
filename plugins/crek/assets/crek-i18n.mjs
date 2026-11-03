// SPDX-License-Identifier: GPL-3.0-only
/**
 * crek-i18n — the fixed wording of every CREK script, from i18n.json next to this file.
 *
 * presentation.language may be a code ("pl", "en-GB") or a name in any listed form ("Polish",
 * "polski"). No value at all means the plugin default, Polish; a value with no dictionary means
 * English. This is the rule written in skills/apply/references/reporting.md (*Language*).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_LANG = 'pl';
export const FALLBACK_LANG = 'en';

let cached = null;

/** The whole dictionary {code: {key: text}}; {} (with a warning) when i18n.json is unreadable. */
export function loadI18n() {
  if (cached) return cached;
  try {
    cached = JSON.parse(readFileSync(fileURLToPath(new URL('./i18n.json', import.meta.url)), 'utf8'));
  } catch (err) {
    console.error(`warning: cannot read i18n.json (${err.message}); printing message keys`);
    cached = {};
  }
  return cached;
}

/** Language code with a dictionary for a presentation.language value. */
export function resolveLang(value, dict = loadI18n()) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return dict[DEFAULT_LANG] ? DEFAULT_LANG : FALLBACK_LANG;
  if (dict[v]) return v;
  const base = v.split(/[-_]/)[0];
  if (dict[base]) return base;
  for (const [code, d] of Object.entries(dict)) {
    if ((d.language_names ?? []).some((n) => n.toLowerCase() === v)) return code;
  }
  return FALLBACK_LANG;
}

/** t(key, vars): the text in `lang`, else in English, else the key; {placeholders} filled. */
export function translator(lang, dict = loadI18n()) {
  return (key, vars = {}) => {
    const text = dict[lang]?.[key] ?? dict[FALLBACK_LANG]?.[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
  };
}
