import type { RoleRow } from '@jobbotix/shared-types';
import { photoNorm, roleCountries, suggestTemplate } from './template-suggest';

type R = Parameters<typeof suggestTemplate>[0]['role'];
const role = (over: Partial<R> = {}): R => ({
  company: 'Northwind',
  title: 'Senior Frontend Engineer',
  location: '',
  hiring_countries: [],
  remote_policy: 'unknown' as RoleRow['remote_policy'],
  posting_text: 'We build dashboards with Angular.',
  ...over,
});
const suggest = (
  r: Partial<R>,
  o: {
    words?: number;
    hasPhoto?: boolean;
    allowed?: (id: string) => boolean;
  } = {},
) =>
  suggestTemplate({
    role: role(r),
    words: o.words ?? 400,
    hasPhoto: o.hasPhoto ?? false,
    allowed: o.allowed,
  });

describe('where a job hires', () => {
  it('uses the hiring countries, else what the location names', () => {
    expect(
      roleCountries(role({ hiring_countries: ['DE', 'at', 'Germany'] })),
    ).toEqual(['DE', 'AT']);
    expect(roleCountries(role({ location: 'Berlin, Germany' }))).toEqual([
      'DE',
    ]);
    expect(roleCountries(role({ location: 'Remote (UK)' }))).toEqual(['GB']);
    expect(roleCountries(role({ location: 'Remote' }))).toEqual([]);
    // a two-letter part of an address is a US state as often as a country
    for (const location of ['Wilmington, DE', 'Denver, CO', 'Boise, ID'])
      expect(roleCountries(role({ location })), location).toEqual([]);
    expect(roleCountries(role({ location: 'Austin, TX, USA' }))).toEqual([
      'US',
    ]);
    // "worldwide" with an office address is still anywhere
    expect(
      roleCountries(
        role({ remote_policy: 'worldwide', location: 'Berlin, Germany' }),
      ),
    ).toEqual([]);
  });

  it('takes the stricter photo convention across countries', () => {
    expect(photoNorm(['DE', 'AT', 'CH'])).toBe('customary');
    expect(photoNorm(['US'])).toBe('discouraged');
    expect(photoNorm(['DE', 'GB'])).toBe('discouraged');
    expect(photoNorm(['DE', 'NL'])).toBe('open');
    expect(photoNorm(['SE'])).toBe('open');
    expect(photoNorm([])).toBe('open');
  });
});

describe('suggestTemplate', () => {
  it('suggests the Photo template only where a photo is customary and there is one', () => {
    const de = suggest({ hiring_countries: ['DE'] }, { hasPhoto: true });
    expect(de.id).toBe('photo');
    expect(de.reason).toBe('A photo on a resume is customary in Germany.');
    expect(de.note).toBe('');

    const noPhoto = suggest({ hiring_countries: ['DE', 'AT'] });
    expect(noPhoto.id).toBe('classic');
    expect(noPhoto.note).toContain('customary in Germany and Austria');
    expect(noPhoto.note).toContain('Add one');
  });

  it('never suggests a photo for the US, the UK or a job that could be anywhere', () => {
    for (const r of [
      { hiring_countries: ['US'] },
      { location: 'London, United Kingdom' },
      { hiring_countries: ['DE', 'CA'] },
      { remote_policy: 'worldwide' as RoleRow['remote_policy'] },
      {},
    ]) {
      const s = suggest(r, { hasPhoto: true });
      expect(s.id, JSON.stringify(r)).not.toBe('photo');
      expect(s.note, JSON.stringify(r)).toMatch(/without a photo|without one/);
    }
    expect(suggest({ hiring_countries: ['US'] }).note).toContain(
      'Employers in United States ask for resumes without a photo',
    );
  });

  it('picks by the kind of employer and the length of the resume', () => {
    expect(suggest({ company: 'First Atlantic Bank' }).id).toBe('serif');
    expect(suggest({ posting_text: 'A Series B start-up' }).id).toBe('modern');
    expect(suggest({ title: 'Senior Product Designer' }).id).toBe('banner');
    const long = suggest({}, { words: 900 });
    expect(long.id).toBe('compact');
    expect(long.reason).toContain('900 words');
    // a formal employer outranks a long resume
    expect(suggest({ company: 'Ministry of Finance' }, { words: 900 }).id).toBe(
      'serif',
    );
    // nothing stands out: the neutral one
    const plain = suggest({ hiring_countries: ['NL'] });
    expect(plain.id).toBe('classic');
    expect(plain.note).toBe('');
  });

  it('stays on Classic when the plan does not cover the template it would pick', () => {
    const s = suggest(
      { hiring_countries: ['DE'] },
      { hasPhoto: true, allowed: (id) => id === 'classic' },
    );
    expect(s.id).toBe('classic');
    expect(s.reason).toContain('template on your plan');
  });
});
