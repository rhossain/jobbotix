import { describe, expect, it } from 'vitest';
import { LOCAL_JOB_COUNTRIES, localCoverage } from './local-coverage';

describe('localCoverage', () => {
  it('splits countries by whether on-site jobs can be found there', () => {
    expect(localCoverage(['CA', 'BD', 'CA', ''])).toEqual({
      covered: ['CA'],
      missing: ['BD'],
    });
  });

  it('lists each country once', () => {
    expect(new Set(LOCAL_JOB_COUNTRIES).size).toBe(LOCAL_JOB_COUNTRIES.length);
  });
});
