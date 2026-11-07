// Country and region names to ISO 3166-1 alpha-2 codes, and region membership.
//
// Country names come from the runtime's own ICU data (Intl.DisplayNames), so
// every territory is covered without a hand-kept table; the aliases below add
// the spellings job boards actually use ("USA", "UK", "UAE", "South Korea").
// Regions are the coarse labels boards put in place of a country list
// ("Europe", "EMEA", "LATAM"); regionIncludes answers whether a country sits
// inside one.

const strip = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '')
    .replace(/ and the /g, ' and ');

// Pseudo-regions, and territories nobody lists as where they live or work
// (Antarctica, Ascension, Clipperton, Diego Garcia, Ceuta & Melilla, Canary
// Islands, Tristan da Cunha, Sark, Bouvet, Heard & McDonald, US Outlying).
const NOT_COUNTRIES = new Set(
  'EU EZ UN QO XA XB ZZ AQ AC CP DG EA IC TA CQ BV HM UM'.split(' '),
);

const ALIASES: Record<string, string> = {
  usa: 'US',
  us: 'US',
  'u s': 'US',
  'u s a': 'US',
  'united states of america': 'US',
  america: 'US',
  uk: 'GB',
  'u k': 'GB',
  britain: 'GB',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  uae: 'AE',
  emirates: 'AE',
  dubai: 'AE',
  'south korea': 'KR',
  korea: 'KR',
  'republic of korea': 'KR',
  'north korea': 'KP',
  russia: 'RU',
  'russian federation': 'RU',
  vietnam: 'VN',
  'viet nam': 'VN',
  'czech republic': 'CZ',
  czechia: 'CZ',
  turkey: 'TR',
  turkiye: 'TR',
  holland: 'NL',
  'the netherlands': 'NL',
  'ivory coast': 'CI',
  'cote d ivoire': 'CI',
  'hong kong': 'HK',
  macau: 'MO',
  macao: 'MO',
  taiwan: 'TW',
  'mainland china': 'CN',
  prc: 'CN',
  bosnia: 'BA',
  'north macedonia': 'MK',
  macedonia: 'MK',
  'the philippines': 'PH',
  burma: 'MM',
  eswatini: 'SZ',
  swaziland: 'SZ',
  'cape verde': 'CV',
  'palestinian territories': 'PS',
  palestine: 'PS',
  'vatican city': 'VA',
  'holy see': 'VA',
  // ISO's "Name, Qualifier" spellings, as boards copy them
  'congo the democratic republic of': 'CD',
  'congo the democratic republic of the': 'CD',
  'democratic republic of congo': 'CD',
  'dr congo': 'CD',
  drc: 'CD',
  congo: 'CG',
  'republic of congo': 'CG',
  'korea republic of': 'KR',
  'korea democratic people s republic of': 'KP',
  'iran islamic republic of': 'IR',
  'tanzania united republic of': 'TZ',
  'moldova republic of': 'MD',
  'bolivia plurinational state of': 'BO',
  'venezuela bolivarian republic of': 'VE',
  'micronesia federated states of': 'FM',
  'lao people s democratic republic': 'LA',
  'syrian arab republic': 'SY',
  'taiwan province of china': 'TW',
  'palestine state of': 'PS',
  'brunei darussalam': 'BN',
  'cabo verde': 'CV',
  'virgin islands british': 'VG',
  'virgin islands u s': 'VI',
  'macedonia the former yugoslav republic of': 'MK',
};

let NAME_TO_CODE: Map<string, string> | null = null;

function nameIndex(): Map<string, string> {
  if (NAME_TO_CODE) return NAME_TO_CODE;
  const map = new Map<string, string>();
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const A = 'A'.charCodeAt(0);
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i) + String.fromCharCode(A + j);
      if (NOT_COUNTRIES.has(code)) continue;
      let name: string | undefined;
      try {
        name = names.of(code);
      } catch {
        continue;
      }
      if (!name || name === code) continue;
      // Legacy codes (DD, SU, YU, ...) canonicalise to a current one; skip them.
      if (Intl.getCanonicalLocales(`und-${code}`)[0]?.split('-')[1] !== code)
        continue;
      map.set(strip(name), code);
      // "Hong Kong SAR China" -> "hong kong"; "Myanmar (Burma)" -> "myanmar"
      const short = strip(
        name.replace(/\(.*?\)/g, '').replace(/\bSAR China\b/i, ''),
      );
      if (short && !map.has(short)) map.set(short, code);
    }
  }
  for (const [alias, code] of Object.entries(ALIASES)) map.set(alias, code);
  NAME_TO_CODE = map;
  return map;
}

/** ISO code for a country name or code ("Germany", "DE", "UK"); null when unknown. */
export function toCountryCode(input: string): string | null {
  const raw = input.trim();
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const up = raw.toUpperCase();
    if (up === 'UK') return 'GB';
    const known = [...nameIndex().values()].includes(up);
    return known ? up : null;
  }
  return nameIndex().get(strip(raw)) ?? null;
}

const EUROPE =
  'AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH UA GB VA GI FO IM JE GG AX';
const EU =
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE';
const MIDDLE_EAST = 'AE BH EG IR IQ IL JO KW LB OM PS QA SA SY TR YE';
const AFRICA =
  'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW';
const SOUTH_ASIA = 'AF BD BT IN MV NP PK LK';
const SOUTHEAST_ASIA = 'BN KH ID LA MY MM PH SG TH TL VN';
const EAST_ASIA = 'CN HK JP KP KR MN MO TW';
const CENTRAL_ASIA = 'KZ KG TJ TM UZ AM AZ GE';
const OCEANIA = 'AU NZ FJ PG SB VU WS TO KI TV NR PW FM MH';
const NORTH_AMERICA = 'US CA MX';
const CENTRAL_AMERICA_CARIBBEAN =
  'BZ CR SV GT HN NI PA CU DO HT JM TT BS BB PR AG DM GD KN LC VC';
const SOUTH_AMERICA = 'AR BO BR CL CO EC GY PY PE SR UY VE';

const set = (...lists: string[]) => new Set(lists.join(' ').split(' '));

const REGIONS: Record<string, Set<string>> = {
  europe: set(EUROPE),
  eu: set(EU),
  'european union': set(EU),
  'middle east': set(MIDDLE_EAST),
  mena: set(MIDDLE_EAST, 'DZ LY MA TN'),
  africa: set(AFRICA),
  asia: set(SOUTH_ASIA, SOUTHEAST_ASIA, EAST_ASIA, CENTRAL_ASIA, MIDDLE_EAST),
  'south asia': set(SOUTH_ASIA),
  'southeast asia': set(SOUTHEAST_ASIA),
  'south east asia': set(SOUTHEAST_ASIA),
  'east asia': set(EAST_ASIA),
  apac: set(SOUTH_ASIA, SOUTHEAST_ASIA, EAST_ASIA, OCEANIA),
  'asia pacific': set(SOUTH_ASIA, SOUTHEAST_ASIA, EAST_ASIA, OCEANIA),
  oceania: set(OCEANIA),
  anz: set('AU NZ'),
  emea: set(EUROPE, MIDDLE_EAST, AFRICA),
  'north america': set(NORTH_AMERICA),
  americas: set(NORTH_AMERICA, CENTRAL_AMERICA_CARIBBEAN, SOUTH_AMERICA),
  'south america': set(SOUTH_AMERICA),
  'central america': set(CENTRAL_AMERICA_CARIBBEAN),
  latam: set('MX', CENTRAL_AMERICA_CARIBBEAN, SOUTH_AMERICA),
  'latin america': set('MX', CENTRAL_AMERICA_CARIBBEAN, SOUTH_AMERICA),
  'european time zones': set(EUROPE),
};

// US state codes as boards write them after a city ("Austin, TX"). DE and IN
// are left out: "Berlin, DE" and "Pune, IN" are far commoner in these feeds
// than Delaware and Indiana.
const US_STATE_CODES = new Set(
  'AL AK AZ AR CA CO CT FL GA HI ID IL IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(
    ' ',
  ),
);
const US_STATE_NAMES = new Set([
  'alabama',
  'alaska',
  'arizona',
  'arkansas',
  'california',
  'colorado',
  'connecticut',
  'delaware',
  'florida',
  'hawaii',
  'idaho',
  'illinois',
  'indiana',
  'iowa',
  'kansas',
  'kentucky',
  'louisiana',
  'maine',
  'maryland',
  'massachusetts',
  'michigan',
  'minnesota',
  'mississippi',
  'missouri',
  'montana',
  'nebraska',
  'nevada',
  'new hampshire',
  'new jersey',
  'new mexico',
  'new york',
  'north carolina',
  'north dakota',
  'ohio',
  'oklahoma',
  'oregon',
  'pennsylvania',
  'rhode island',
  'south carolina',
  'south dakota',
  'tennessee',
  'texas',
  'utah',
  'vermont',
  'virginia',
  'washington',
  'west virginia',
  'wisconsin',
  'wyoming',
  'district of columbia',
  'bay area',
  'silicon valley',
  'nyc',
  'san francisco',
  'new york city',
  'los angeles',
  'seattle',
  'boston',
  'austin',
  'chicago',
  'denver',
]);

/** "Austin, TX", "Texas", "San Francisco" -> true: a place in the United States. */
export function isUsPlace(input: string): boolean {
  const raw = input.trim();
  const m = raw.match(/^([A-Za-z .'-]+),\s*([A-Z]{2})$/);
  if (m && US_STATE_CODES.has(m[2])) return true;
  const s = strip(raw);
  if (toCountryCode(raw)) return false; // "Georgia" is the country
  return US_STATE_NAMES.has(s) || US_STATE_NAMES.has(s.replace(/,.*$/, ''));
}

/** Canonical region label for a board's wording, or null when it is not a region. */
export function toRegion(input: string): string | null {
  const s = strip(input).replace(/ only$/, '');
  return s in REGIONS ? s : null;
}

export function regionIncludes(region: string, country: string): boolean {
  return REGIONS[strip(region)]?.has(country.toUpperCase()) ?? false;
}

const WORLDWIDE =
  /^(worldwide|anywhere|global|globally|world ?wide|remote|anywhere in the world|all countries|international|work from anywhere|100 remote|fully remote|no restrictions|remote anywhere|anywhere remote)$/;

export interface ParsedLocations {
  worldwide: boolean;
  countries: string[];
  regions: string[];
  unknown: string[];
}

/**
 * Splits a board's location list ("Germany", "Europe", "Worldwide",
 * "US / Canada") into ISO codes, region labels and leftovers.
 */
export function parseLocations(items: string[]): ParsedLocations {
  const out: ParsedLocations = {
    worldwide: false,
    countries: [],
    regions: [],
    unknown: [],
  };
  // A whole item first ("Congo, The Democratic Republic of the" is one
  // country); split on separators only when the whole item is not a place.
  const parts = items.flatMap((x) => {
    const whole = String(x ?? '')
      .replace(/\(.*?\)/g, '')
      .trim();
    if (!whole) return [];
    if (isUsPlace(whole.replace(/^remote[:\s-]*/i, '')))
      return ['United States'];
    const w = strip(whole).replace(/^remote /, '');
    if (WORLDWIDE.test(w) || toRegion(w) || toCountryCode(w)) return [whole];
    return whole
      .split(/[,;/|]| or | and /i)
      .map((y) => y.trim())
      .filter(Boolean);
  });
  for (const p of parts) {
    const s = strip(p)
      .replace(/^remote /, '')
      .replace(/ remote$/, '')
      .replace(/ only$/, '');
    if (!s) continue;
    if (WORLDWIDE.test(s)) {
      out.worldwide = true;
      continue;
    }
    const region = toRegion(s);
    if (region) {
      if (!out.regions.includes(region)) out.regions.push(region);
      continue;
    }
    const code = toCountryCode(s);
    if (code) {
      if (!out.countries.includes(code)) out.countries.push(code);
      continue;
    }
    out.unknown.push(p);
  }
  return out;
}
