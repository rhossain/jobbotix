import { describe, expect, it } from 'vitest';
import { careersSystem } from './careers';

describe('careersSystem', () => {
  it('reads the six systems from careers and job links', () => {
    expect(careersSystem('https://boards.greenhouse.io/Acme/jobs/1')).toEqual({
      kind: 'greenhouse',
      slug: 'acme',
    });
    expect(careersSystem('https://job-boards.greenhouse.io/acme')).toEqual({
      kind: 'greenhouse',
      slug: 'acme',
    });
    expect(careersSystem('https://jobs.lever.co/beta')).toEqual({
      kind: 'lever',
      slug: 'beta',
    });
    expect(careersSystem(' https://jobs.ashbyhq.com/gamma/abc ')).toEqual({
      kind: 'ashby',
      slug: 'gamma',
    });
    expect(careersSystem('https://apply.workable.com/delta/')).toEqual({
      kind: 'workable',
      slug: 'delta',
    });
    expect(careersSystem('https://Epsilon.recruitee.com/o/designer')).toEqual({
      kind: 'recruitee',
      slug: 'epsilon',
    });
    expect(careersSystem('https://zeta.jobs.personio.de/job/123')).toEqual({
      kind: 'personio',
      slug: 'zeta',
    });
    expect(careersSystem('https://zeta.jobs.personio.com')).toEqual({
      kind: 'personio',
      slug: 'zeta',
    });
  });

  it('returns null for anything else', () => {
    expect(careersSystem('https://acme.com/careers')).toBeNull();
    expect(
      careersSystem('https://himalayas.app/companies/acme/jobs/x'),
    ).toBeNull();
    expect(careersSystem('not a link')).toBeNull();
  });
});
