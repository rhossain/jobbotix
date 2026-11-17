import { describe, expect, it } from 'vitest';
import { isLinkedInUrl } from './linkedin';

describe('isLinkedInUrl', () => {
  it('knows LinkedIn pages, its subdomains and its short links', () => {
    for (const url of [
      'https://www.linkedin.com/jobs/view/4012345678',
      'https://linkedin.com/jobs/view/4012345678/',
      'http://www.linkedin.com/jobs/view/1',
      'https://bd.linkedin.com/jobs/view/senior-angular-engineer-at-acme-1',
      'https://WWW.LinkedIn.com/comm/jobs/view/1?trk=eml',
      'https://www.linkedin.com./jobs/view/1',
      'https://lnkd.in/gAbCdEf',
      '  https://www.linkedin.com/jobs/collections/recommended/?currentJobId=1  ',
    ])
      expect(isLinkedInUrl(url), url).toBe(true);
  });

  it('leaves every other site alone, however alike it looks', () => {
    for (const url of [
      'https://boards.greenhouse.io/acme/jobs/1',
      'https://notlinkedin.com/jobs/view/1',
      'https://linkedin.com.example.org/jobs/view/1',
      'https://example.org/?next=https://www.linkedin.com/jobs/view/1',
      'https://linkedin.com@example.org/jobs/view/1',
      'https://xlnkd.in/abc',
      'ftp://www.linkedin.com/jobs/view/1',
      'linkedin.com/jobs/view/1',
      '',
    ])
      expect(isLinkedInUrl(url), url).toBe(false);
  });
});
