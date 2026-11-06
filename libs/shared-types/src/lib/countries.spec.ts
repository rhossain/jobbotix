import { describe, expect, it } from 'vitest';
import {
  countryName,
  countryOptions,
  parseCountryList,
  toCountryCode,
} from './countries';

describe('countries', () => {
  it('lists real countries and nothing pseudo', () => {
    const codes = countryOptions().map((o) => o.code);
    expect(codes).toContain('BD');
    expect(codes).toContain('DE');
    expect(codes).not.toContain('EU');
    expect(codes.length).toBeGreaterThan(200);
  });

  it('resolves names, codes and common aliases', () => {
    expect(toCountryCode('Bangladesh')).toBe('BD');
    expect(toCountryCode('de')).toBe('DE');
    expect(toCountryCode('UK')).toBe('GB');
    expect(toCountryCode('UAE')).toBe('AE');
    expect(toCountryCode('Atlantis')).toBeNull();
    expect(countryName('PL')).toBe('Poland');
  });

  it('parses a typed list and reports what it could not read', () => {
    expect(parseCountryList('Germany, ae, uk, Germany, Narnia')).toEqual({
      codes: ['DE', 'AE', 'GB'],
      unknown: ['Narnia'],
    });
  });
});
