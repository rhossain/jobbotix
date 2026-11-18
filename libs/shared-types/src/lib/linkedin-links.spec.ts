import { describe, expect, it } from 'vitest';
import {
  companyKey,
  linkedInJobSearchUrl,
  linkedInPeopleSearchUrl,
} from './linkedin-links';

/**
 * The same names are checked against public.company_key() in
 * supabase/tests/rls.sql. Change one list and change the other.
 */
export const COMPANY_KEYS: [name: string, key: string][] = [
  ['Acme', 'acme'],
  ['ACME, Inc.', 'acme'],
  ['Acme Inc', 'acme'],
  ['acme llc', 'acme'],
  ['Acme Corporation', 'acme'],
  ['The Acme Company', 'acme'],
  ['Acme Co., Ltd.', 'acme'],
  ['Globex GmbH', 'globex'],
  ['Initech Pvt. Ltd.', 'initech'],
  ['Hooli (YC W21)', 'hooli'],
  ['Johnson & Johnson', 'johnson and johnson'],
  ['AT&T', 'at and t'],
  ['Brain Station 23 Ltd.', 'brain station 23'],
  ['  Northwind   Traders  ', 'northwind traders'],
  ['Acme Labs', 'acme labs'],
  ['Inc', 'inc'],
  ['The', 'the'],
  ['Company Co', 'company'],
  ['', ''],
  ['---', ''],
  ['株式会社スカイコム', '株式会社スカイコム'],
  ['منصة خطوة التعليمية', 'منصة خطوة التعليمية'],
  ['সারাবাংলা', 'সারাবাংলা'],
  ['Индивидуальный предприниматель', 'Индивидуальный предприниматель'],
  ['Société Générale', 'société générale'],
  ['Grab – Singapore', 'grab singapore'],
  ['Acme・Japan', 'acme japan'],
  ['..', ''],
];

describe('companyKey', () => {
  it('gives one key to the ways a company writes its name', () => {
    for (const [name, key] of COMPANY_KEYS)
      expect(companyKey(name), name).toBe(key);
  });

  it('keeps different companies apart', () => {
    expect(companyKey('Acme')).not.toBe(companyKey('Acme Labs'));
    expect(companyKey('Globex')).not.toBe(companyKey('Globex Health'));
  });
});

describe('LinkedIn search links', () => {
  it('opens LinkedIn’s people search for a company', () => {
    expect(linkedInPeopleSearchUrl(' Johnson & Johnson ')).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=Johnson+%26+Johnson',
    );
  });

  it('opens LinkedIn’s job search for a title, place and remote', () => {
    expect(linkedInJobSearchUrl({ keywords: 'Senior Angular Engineer' })).toBe(
      'https://www.linkedin.com/jobs/search/?keywords=Senior+Angular+Engineer',
    );
    expect(
      linkedInJobSearchUrl({
        keywords: 'Frontend Engineer',
        location: 'Bangladesh',
        remote: true,
      }),
    ).toBe(
      'https://www.linkedin.com/jobs/search/?keywords=Frontend+Engineer&location=Bangladesh&f_WT=2',
    );
  });
});
