/**
 * Countries where Jobbotix can find on-site and hybrid jobs, because a job
 * site it reads searches inside that country. Today that is Adzuna's list:
 * keep it in step with ADZUNA_COUNTRIES in
 * supabase/functions/_shared/sources/aggregators.ts when a country-scoped
 * source is added or a key for one is set.
 *
 * Remote jobs do not depend on this list: they come from every job site.
 */
export const LOCAL_JOB_COUNTRIES: readonly string[] = [
  'GB',
  'US',
  'CA',
  'AU',
  'DE',
  'FR',
  'NL',
  'PL',
  'IN',
  'SG',
  'ZA',
  'NZ',
  'AT',
  'BE',
  'BR',
  'CH',
  'ES',
  'IT',
  'MX',
];

/** Splits the countries a person can work in by whether on-site jobs can be found there. */
export function localCoverage(countries: readonly string[]): {
  covered: string[];
  missing: string[];
} {
  const seen = [...new Set(countries.filter(Boolean))];
  return {
    covered: seen.filter((c) => LOCAL_JOB_COUNTRIES.includes(c)),
    missing: seen.filter((c) => !LOCAL_JOB_COUNTRIES.includes(c)),
  };
}
