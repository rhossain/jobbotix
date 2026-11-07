/**
 * Country names and ISO 3166-1 alpha-2 codes for the app, from the runtime's
 * own ICU data. The Edge Functions keep a fuller copy (region membership,
 * board spellings) in supabase/functions/_shared/countries.ts.
 */

export interface CountryOption {
  code: string;
  name: string;
}

// Pseudo-regions, and territories nobody lists as where they live or work
// (Antarctica, Ascension, Clipperton, Diego Garcia, Ceuta & Melilla, Canary
// Islands, Tristan da Cunha, Sark, Bouvet, Heard & McDonald, US Outlying).
const NOT_COUNTRIES = new Set(
  'EU EZ UN QO XA XB ZZ AQ AC CP DG EA IC TA CQ BV HM UM'.split(' '),
);
const ALIASES: Record<string, string> = {
  usa: 'US',
  us: 'US',
  uk: 'GB',
  britain: 'GB',
  england: 'GB',
  uae: 'AE',
  'south korea': 'KR',
  korea: 'KR',
  russia: 'RU',
  vietnam: 'VN',
  'czech republic': 'CZ',
  turkey: 'TR',
  holland: 'NL',
};

const key = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

let cache: CountryOption[] | null = null;

/** Every country, sorted by English name. */
export function countryOptions(): CountryOption[] {
  if (cache) return cache;
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const out: CountryOption[] = [];
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(65 + i, 65 + j);
      if (NOT_COUNTRIES.has(code)) continue;
      let name: string | undefined;
      try {
        name = names.of(code);
      } catch {
        continue;
      }
      // Legacy codes (DD, SU, YU, ...) canonicalise to a current one; skip them.
      const current = Intl.getCanonicalLocales(`und-${code}`)[0]?.split('-')[1];
      if (name && name !== code && current === code) out.push({ code, name });
    }
  }
  cache = out.sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

/** ISO code for "Germany", "de", "UK" or "UAE"; null when it is not a country. */
export function toCountryCode(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const opts = countryOptions();
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const up = raw.toUpperCase() === 'UK' ? 'GB' : raw.toUpperCase();
    return opts.some((o) => o.code === up) ? up : null;
  }
  const k = key(raw);
  if (ALIASES[k]) return ALIASES[k];
  return opts.find((o) => key(o.name) === k)?.code ?? null;
}

export function countryName(code: string): string {
  return countryOptions().find((o) => o.code === code)?.name ?? code;
}

/** Parses "Germany, AE, uk" into unique codes, plus whatever did not parse. */
export function parseCountryList(input: string): {
  codes: string[];
  unknown: string[];
} {
  const codes: string[] = [];
  const unknown: string[] = [];
  for (const part of input.split(/[,;\n]/)) {
    const p = part.trim();
    if (!p) continue;
    const c = toCountryCode(p);
    if (c) {
      if (!codes.includes(c)) codes.push(c);
    } else unknown.push(p);
  }
  return { codes, unknown };
}
