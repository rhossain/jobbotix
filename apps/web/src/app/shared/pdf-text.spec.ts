import { emptyResume } from '@jobbotix/shared-types';
import { droppedNote, pdfSafe, pdfSafeResume } from './pdf-text';

describe('pdfSafe', () => {
  it('leaves what the font can show alone', () => {
    const s =
      'Café résumé, naïve, São Paulo, Kraków, Zürich — “quoted” ‘x’ 3× gain • 40+ apps · €5 – Šárka';
    expect(pdfSafe(s)).toEqual({ text: s, dropped: [] });
  });

  it('swaps lookalike punctuation for the plain form', () => {
    // the non-breaking hyphen AI models write, a real minus, odd spaces
    expect(
      pdfSafe('AI\u2011assisted, time\u2010to\u2010interactive').text,
    ).toBe('AI-assisted, time-to-interactive');
    expect(pdfSafe('6s \u2192 2s, \u2265 95%, \u2264 3, x \u2260 y').text).toBe(
      '6s -> 2s, >= 95%, <= 3, x != y',
    );
    expect(pdfSafe('a\u202fb\u2009c\u200bd\ufeff').text).toBe('a b cd');
    expect(pdfSafe('\u25cf one \u25e6 two').text).toBe('• one • two');
  });

  it('keeps the letter when only its mark is missing from the font', () => {
    expect(pdfSafe('Łódź, İstanbul, Nguyễn, Čapek, Đorđe').text).toBe(
      'Lódz, Istanbul, Nguyen, Capek, Dorde',
    );
    expect(pdfSafe('Łódź').dropped).toEqual([]);
  });

  it('drops and reports what has no form the font can show', () => {
    const r = pdfSafe('Dhaka ঢাকা office ✅ done 東京');
    expect(r.text).toBe('Dhaka office done ');
    expect(r.dropped).toEqual(['ঢ', 'া', 'ক', '✅', '東', '京']);
  });
});

describe('pdfSafeResume', () => {
  it('cleans every string and reports each dropped character once', () => {
    const r = {
      ...emptyResume(),
      summary: 'AI\u2011assisted ✅',
      experience: [
        {
          title: 'Engineer',
          company: 'Łódź Labs',
          location: '',
          start: '2020-01',
          end: '',
          bullets: ['Cut load 6s \u2192 2s ✅'],
        },
      ],
    };
    const safe = pdfSafeResume(r);
    expect(safe.resume.summary).toBe('AI-assisted ');
    expect(safe.resume.experience[0].company).toBe('Lódz Labs');
    expect(safe.resume.experience[0].bullets).toEqual(['Cut load 6s -> 2s ']);
    expect(safe.resume.experience[0].start).toBe('2020-01');
    expect(safe.dropped).toEqual(['✅']);
    // the resume handed in is not changed
    expect(r.summary).toBe('AI\u2011assisted ✅');
  });
});

describe('droppedNote', () => {
  it('says nothing when nothing was dropped, and names what was', () => {
    expect(droppedNote([])).toBe('');
    expect(droppedNote(['✅'])).toContain(
      'this character, so it was left out: ✅.',
    );
    expect(droppedNote('abcdefghij'.split(''))).toContain(
      'a b c d e f g h and 2 more',
    );
  });
});
