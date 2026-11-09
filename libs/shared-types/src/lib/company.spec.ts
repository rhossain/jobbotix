import { describe, expect, it } from 'vitest';
import {
  companySiteFromUrl,
  localCompanyResearch,
  normaliseCompanyResearch,
  parseResearchReply,
  researchPrompt,
} from './company';

const posting = `Senior Angular Engineer

Quill & Co is a writing platform that helps legal teams draft contracts faster. We are a team of 85 people, founded in 2019 and backed by Index Ventures.
We are headquartered in Lisbon, Portugal. This is a fully remote role and we hire anywhere in the world through Deel.
You should have some overlap with UTC between 10:00 and 14:00.
Our engineering team ships to production daily and does code review on every change.
The process includes a paid test project of about four hours.`;

describe('companySiteFromUrl', () => {
  it('takes the company domain from its own careers site', () => {
    expect(companySiteFromUrl('https://careers.quill.co/jobs/42')).toBe(
      'https://quill.co',
    );
    expect(companySiteFromUrl('https://jobs.acme.co.uk/x')).toBe(
      'https://acme.co.uk',
    );
  });

  it('never treats a job board or ATS as the company site', () => {
    expect(companySiteFromUrl('https://boards.greenhouse.io/quill/jobs/1')).toBe(
      '',
    );
    expect(companySiteFromUrl('https://www.linkedin.com/jobs/view/1')).toBe('');
    expect(companySiteFromUrl('https://quill.ashbyhq.com/abc')).toBe('');
    expect(companySiteFromUrl('not a url')).toBe('');
  });
});

describe('localCompanyResearch', () => {
  const r = localCompanyResearch({
    company: 'Quill & Co',
    url: 'https://careers.quill.co/jobs/42',
    text: posting,
  });

  it('pulls the facts the posting states', () => {
    expect(r.summary).toContain('writing platform');
    expect(r.size).toMatch(/85 people/);
    expect(r.founded).toMatch(/2019/);
    expect(r.funding).toMatch(/Index Ventures/);
    expect(r.headquarters).toBe('Lisbon');
    expect(r.website).toBe('https://quill.co');
  });

  it('collects remote-hiring and engineering lines from the text', () => {
    expect(r.remoteHiring.some((x) => x.includes('Deel'))).toBe(true);
    expect(r.remoteHiring.some((x) => x.includes('UTC'))).toBe(true);
    expect(r.engineering.some((x) => x.includes('code review'))).toBe(true);
  });

  it('flags a test project and marks itself as local', () => {
    expect(r.redFlags).toContain('Asks for a trial or test project');
    expect(r.method).toBe('local');
    expect(r.webSearch).toBe(false);
    expect(r.researchedAt).not.toBe('');
    expect(r.sources[0].url).toBe('https://careers.quill.co/jobs/42');
  });

  it('invents nothing when the posting says nothing', () => {
    const empty = localCompanyResearch({
      company: 'Acme',
      url: 'https://boards.greenhouse.io/acme/1',
      text: 'Senior Angular Engineer. Angular, TypeScript.',
    });
    expect(empty.summary).toBe('');
    expect(empty.size).toBe('');
    expect(empty.funding).toBe('');
    expect(empty.website).toBe('');
    expect(empty.redFlags).toEqual([]);
  });
});

describe('parseResearchReply', () => {
  it('reads the JSON after any preamble and drops unknowns', () => {
    const reply = `Here is what I found.
{"summary": "Quill & Co builds contract drafting software for legal teams.",
 "website": "quill.co", "headquarters": "Lisbon", "founded": "2019",
 "size": "unknown", "funding": "Series A, $12M (2023)",
 "remoteHiring": ["Hires worldwide through Deel"], "product": [], "engineering": [],
 "reputation": ["3.9 on Glassdoor (40 reviews)"], "recentNews": [], "redFlags": [],
 "sources": [{"title": "Quill", "url": "https://quill.co"}, {"title": "dup", "url": "https://quill.co"}, {"title": "bad", "url": "ftp://x"}]}`;
    const r = parseResearchReply(reply);
    expect(r).not.toBeNull();
    expect(r?.website).toBe('https://quill.co');
    expect(r?.size).toBe('');
    expect(r?.funding).toBe('Series A, $12M (2023)');
    expect(r?.sources).toEqual([{ title: 'Quill', url: 'https://quill.co' }]);
  });

  it('rejects replies with nothing useful in them', () => {
    expect(parseResearchReply('Sorry, I could not find this company.')).toBe(
      null,
    );
    expect(parseResearchReply('{"summary": "", "product": []}')).toBe(null);
  });
});

describe('normaliseCompanyResearch', () => {
  it('fills every field from an empty stored value', () => {
    const r = normaliseCompanyResearch({});
    expect(r.researchedAt).toBe('');
    expect(r.sources).toEqual([]);
    expect(r.method).toBe('');
  });
});

describe('researchPrompt', () => {
  it('asks for web search only when it is available', () => {
    const base = {
      company: 'Quill',
      title: 'Senior Angular Engineer',
      url: 'https://quill.co/jobs/1',
      text: posting,
    };
    expect(researchPrompt({ ...base, webSearch: true })).toContain(
      'Use web search',
    );
    expect(researchPrompt({ ...base, webSearch: false })).toContain(
      'cannot search the web',
    );
  });
});
