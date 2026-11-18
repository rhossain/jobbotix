import { describe, expect, it } from 'vitest';
import { isLinkedInUrl, jobLinkToKeep, linkedInJobId } from './linkedin';

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

describe('jobLinkToKeep', () => {
  it("turns a search page with a job open in it into the job's own link", () => {
    const fromSearch =
      'https://www.linkedin.com/jobs/search-results/?currentJobId=4480004226&eBP=CwEAAAGh7aVVoBeW-_3k11Kkl6Ycd__yLwf&refId=hrbfaHw34VqbGTQ%2FmiD55Q%3D%3D&trackingId=BX%2FrO6nUAE1GjEGQVEzdcA%3D%3D&keywords=Frontend%20Developer&origin=PREFERENCES_LANDING&geoId=103363366';
    expect(linkedInJobId(fromSearch)).toBe('4480004226');
    expect(jobLinkToKeep(fromSearch)).toBe(
      'https://www.linkedin.com/jobs/view/4480004226/',
    );
  });

  it('gives one link for every way LinkedIn shows the same job', () => {
    for (const url of [
      'https://www.linkedin.com/jobs/view/4480004226',
      'https://www.linkedin.com/jobs/view/4480004226/?trackingId=abc&refId=def',
      'https://bd.linkedin.com/jobs/view/frontend-developer-at-acme-4480004226?position=1',
      'https://www.linkedin.com/comm/jobs/view/4480004226?trk=eml-email_job_alert',
      'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4480004226',
      'https://www.linkedin.com/jobs/search/?currentJobId=4480004226&keywords=angular',
      '  https://www.linkedin.com/jobs/view/4480004226/  ',
    ])
      expect(jobLinkToKeep(url), url).toBe(
        'https://www.linkedin.com/jobs/view/4480004226/',
      );
  });

  it('keeps every other link as it was typed', () => {
    for (const url of [
      'https://boards.greenhouse.io/acme/jobs/4480004226?gh_src=x',
      'https://www.linkedin.com/company/acme/',
      'https://www.linkedin.com/jobs/search/?keywords=angular',
      'https://lnkd.in/gAbCdEf',
      'https://example.org/?currentJobId=4480004226',
      'not a link',
    ])
      expect(jobLinkToKeep(` ${url} `), url).toBe(url);
  });
});
