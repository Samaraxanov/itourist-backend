// Helpers for the { uz, ru, en } multilingual JSON shape used across the catalog.

export type Multilingual = { uz?: string; ru?: string; en?: string } | null | undefined;

// Pick the best available string for a locale, with a sensible fallback chain.
export function pick(field: Multilingual, locale: 'uz' | 'ru' | 'en' = 'en'): string {
  if (!field) return '';
  return field[locale] || field.en || field.ru || field.uz || '';
}

// Flatten one or more multilingual fields into a single search string.
// Feeds the maintained `searchText` column that backs full-text search.
export function buildSearchText(...fields: Multilingual[]): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (!f) continue;
    for (const v of [f.uz, f.ru, f.en]) {
      if (v) parts.push(v);
    }
  }
  // Collapse whitespace; cap length so a pathological description can't bloat the row.
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
}
