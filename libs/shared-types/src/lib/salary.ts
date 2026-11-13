// Salaries as numbers: reads the pay line a board or a posting gives
// ("$100k–140k", "€60.000 - €75.000 per year", "$55/h", "USD up to 150k"),
// turns it into a yearly range and converts it between currencies, so roles
// can be sorted by pay and a minimum-pay rule can drop postings below it.
//
// Exchange rates are approximate (mid-2026) and only used to compare against
// a minimum and to sort; the posting's own figure is always what is shown.
//
// Copied to supabase/functions/_shared/salary.ts for the Edge runtime; keep
// the two in step.

export type SalaryPeriod = 'hour' | 'day' | 'week' | 'month' | 'year';

export interface SalaryRange {
  min: number | null;
  max: number | null;
  /** ISO 4217 code, '' when the line names none. */
  currency: string;
  period: SalaryPeriod;
}

/** Units of each currency per US dollar, approximate (mid-2026). */
export const APPROX_RATES_PER_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.87,
  GBP: 0.75,
  CAD: 1.37,
  AUD: 1.53,
  NZD: 1.68,
  CHF: 0.81,
  SEK: 9.6,
  NOK: 10.1,
  DKK: 6.5,
  PLN: 3.7,
  CZK: 21.7,
  HUF: 350,
  RON: 4.4,
  INR: 86,
  BDT: 122,
  PKR: 283,
  LKR: 300,
  SGD: 1.29,
  HKD: 7.8,
  JPY: 146,
  CNY: 7.2,
  PHP: 57,
  IDR: 16300,
  MYR: 4.3,
  AED: 3.67,
  BRL: 5.5,
  MXN: 18.8,
  ARS: 1200,
  ZAR: 18,
  NGN: 1550,
  KES: 129,
  EGP: 49,
  TRY: 40,
  UAH: 41,
  ILS: 3.6,
};

/** The currencies offered for a minimum, most common first. */
export const SALARY_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'CHF',
  'INR',
  'BDT',
  'PKR',
  'SGD',
  'AED',
] as const;

const HOURS_PER: Record<SalaryPeriod, number> = {
  hour: 2080,
  day: 260,
  week: 52,
  month: 12,
  year: 1,
};

const SYMBOLS: [RegExp, string][] = [
  [/(?:CA|C)\$/i, 'CAD'],
  [/(?:AU|A)\$/i, 'AUD'],
  [/NZ\$/i, 'NZD'],
  [/S\$/i, 'SGD'],
  [/R\$/i, 'BRL'],
  [/\$/, 'USD'],
  [/€/, 'EUR'],
  [/£/, 'GBP'],
  [/₹/, 'INR'],
  [/৳|\bTk\.?\s?\d/i, 'BDT'],
  [/¥/, 'JPY'],
];

function currencyOf(text: string): string {
  const codes = text.match(/\b[A-Z]{3}\b/g) ?? [];
  const known = codes.find((c) => c in APPROX_RATES_PER_USD);
  if (known) return known;
  for (const [re, cur] of SYMBOLS) if (re.test(text)) return cur;
  // an unfamiliar code ("XYZ 10") stays unknown rather than assumed
  return codes[0] ?? '';
}

function periodOf(text: string): SalaryPeriod | null {
  const t = text.toLowerCase();
  if (/(?:\/|\bper\b|\ban\b|\ba\b)\s*(?:h|hr|hour)\b|\bhourly\b|\/h\b/.test(t))
    return 'hour';
  if (/(?:\/|\bper\b|\ba\b)\s*day\b|\bdaily\b|\bday rate\b/.test(t))
    return 'day';
  if (/(?:\/|\bper\b|\ba\b)\s*(?:wk|week)\b|\bweekly\b/.test(t)) return 'week';
  if (/(?:\/|\bper\b|\ba\b)\s*(?:mo|month)\b|\bmonthly\b|\bpcm\b/.test(t))
    return 'month';
  if (
    /(?:\/|\bper\b|\ba\b)\s*(?:yr|year|annum)\b|\bannual(?:ly)?\b|\byearly\b|\bp\.?a\.?\b/.test(
      t,
    )
  )
    return 'year';
  return null;
}

/** "60.000", "60,000", "60 000", "95.5k" → numbers; k multiplies by 1000. */
function amounts(text: string): { n: number; k: boolean }[] {
  const out: { n: number; k: boolean }[] = [];
  const re = /(\d{1,3}(?:[,. ]\d{3})+|\d+(?:\.\d+)?)\s*([kK])?(?![\d])/g;
  for (const m of text.matchAll(re)) {
    const raw = m[1];
    const grouped = /[,. ]\d{3}$/.test(raw) && !/^\d+\.\d{1,2}$/.test(raw);
    const n = grouped ? Number(raw.replace(/[,. ]/g, '')) : Number(raw);
    if (Number.isFinite(n) && n > 0) out.push({ n, k: !!m[2] });
  }
  return out;
}

/** Reads a pay line; null when it holds no amount. */
export function parseSalary(
  text: string | null | undefined,
): SalaryRange | null {
  if (!text) return null;
  const s = text.replace(/[–—]/g, '-');
  const found = amounts(s);
  if (!found.length) return null;
  const anyK = found.slice(0, 2).some((a) => a.k);
  const nums = found.slice(0, 2).map((a) => {
    // "$95-130k": the k on the upper end applies to the lower end too
    if (a.k || (anyK && a.n < 1000)) return a.n * 1000;
    return a.n;
  });
  // ignore what reads like a year ("Since 2019") when it is the only number
  if (
    nums.length === 1 &&
    /^(19|20)\d{2}$/.test(String(nums[0])) &&
    !/[$€£₹]|\b[A-Z]{3}\b/.test(s)
  )
    return null;

  let min: number | null = nums[0];
  let max: number | null = nums.length > 1 ? nums[1] : null;
  if (max !== null && max < min) [min, max] = [max, min];
  if (max === null && /\bup to\b|\bmax(?:imum)?\b/i.test(s)) {
    max = min;
    min = null;
  }

  const top = max ?? min ?? 0;
  const period = periodOf(s) ?? (top < 500 ? 'hour' : 'year');
  return { min, max, currency: currencyOf(s), period };
}

/**
 * A range from a board's structured fields, else its text. The fields are
 * yearly, except that boards put an hourly rate in the same fields for
 * hourly and contract roles: a top figure under 500 is an hourly rate, as it
 * is when read from text. (Seen live: "$82" on a contract SDET role was read
 * as USD 82 a year and ruled out as pay below the minimum.)
 */
export function salaryFrom(
  structured: {
    salary_min?: number | null;
    salary_max?: number | null;
    salary_currency?: string | null;
  },
  text: string | null | undefined,
): SalaryRange | null {
  const { salary_min: min, salary_max: max, salary_currency: cur } = structured;
  if ((min && min > 0) || (max && max > 0)) {
    return {
      min: min || null,
      max: max || null,
      currency: (cur ?? '').toUpperCase(),
      period: Math.max(min ?? 0, max ?? 0) < 500 ? 'hour' : 'year',
    };
  }
  return parseSalary(text);
}

/** Converts between currencies at the approximate rates; null if either is unknown. */
export function convert(
  amount: number,
  from: string,
  to: string,
): number | null {
  if (from === to) return amount;
  const a = APPROX_RATES_PER_USD[from];
  const b = APPROX_RATES_PER_USD[to];
  if (!a || !b) return null;
  return (amount / a) * b;
}

/**
 * The range as yearly figures in `currency`. A line with no currency is
 * taken to be in `currency` already. Null when the currency is unknown.
 */
export function yearlyIn(
  r: SalaryRange,
  currency: string,
): { min: number | null; max: number | null } | null {
  const from = r.currency || currency;
  const f = (n: number | null) => {
    if (n === null) return null;
    const c = convert(n * HOURS_PER[r.period], from, currency);
    return c === null ? null : Math.round(c);
  };
  const min = f(r.min);
  const max = f(r.max);
  if ((r.min !== null && min === null) || (r.max !== null && max === null))
    return null;
  return { min, max };
}

/**
 * Whether the range can reach a yearly minimum: its top end (or its only
 * end) at least `minimum`. Null when there is nothing to compare.
 */
export function meetsMinimum(
  r: SalaryRange | null,
  minimum: number,
  currency: string,
): boolean | null {
  if (!r || !(minimum > 0)) return null;
  const y = yearlyIn(r, currency);
  if (!y) return null;
  const top = y.max ?? y.min;
  return top === null ? null : top >= minimum;
}

/** "USD 95k" style for a yearly figure. */
export function formatYearly(n: number, currency: string): string {
  const v =
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
      : n >= 1000
        ? `${Math.round(n / 1000)}k`
        : String(Math.round(n));
  return `${currency ? `${currency} ` : ''}${v}`;
}

/** A sort key: yearly top end in US dollars, -1 when unknown. */
export function salarySortKey(r: SalaryRange | null): number {
  if (!r) return -1;
  const y = yearlyIn(r, 'USD');
  return y ? (y.max ?? y.min ?? -1) : -1;
}
