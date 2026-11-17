import { describe, expect, it } from 'vitest';
import {
  checkGigDraft,
  gigBudgetLine,
  gigOf,
  gigPrompt,
  heuristicGig,
  isUpworkUrl,
  localProposal,
  normaliseGig,
  parseGig,
  proposalPrompt,
  upworkJobUrl,
  upworkSearchUrl,
  emptyGig,
} from './gig';
import { emptyResume } from './resume';

const PASTED = `Angular developer for an analytics dashboard
Posted 2 hours ago
Worldwide

Summary
We need a senior Angular developer to rebuild our analytics dashboard with signals and Tailwind. You will work with our designer and one backend engineer.

More than 30 hrs/week
Hourly
3 to 6 months
Project Length
Expert
Experience Level
$35.00 - $60.00
Hourly

You will be asked to answer the following questions when submitting a proposal:
1. Describe your recent experience with similar projects
2. Which Angular version did you last ship to production?

Skills and Expertise
Angular TypeScript Tailwind CSS RxJS

Activity on this job
Proposals: 5 to 10

About the client
Payment method verified
Rating is 4.9 out of 5.
Germany
Berlin 4:12 PM
23 jobs posted

Send a proposal for: 14 Connects
Available Connects: 80`;

describe('Upwork links', () => {
  it('knows an Upwork page from any other', () => {
    expect(
      isUpworkUrl('https://www.upwork.com/nx/search/jobs/?q=angular'),
    ).toBe(true);
    expect(isUpworkUrl('https://upwork.com/')).toBe(true);
    expect(isUpworkUrl('https://notupwork.com/jobs/~01abc')).toBe(false);
    expect(isUpworkUrl('https://upwork.com.evil.example/jobs/~01abc')).toBe(
      false,
    );
    expect(isUpworkUrl('http://www.upwork.com/jobs/~01abcdefghij')).toBe(false);
    expect(isUpworkUrl('not a link')).toBe(false);
  });

  it('keeps every form of a job link under one address', () => {
    const want = 'https://www.upwork.com/jobs/~01a2b3c4d5e6f7a8b9';
    for (const link of [
      'https://www.upwork.com/jobs/~01a2b3c4d5e6f7a8b9',
      'https://www.upwork.com/jobs/Angular-developer_~01a2b3c4d5e6f7a8b9/',
      'https://www.upwork.com/freelance-jobs/apply/Angular-developer_~01A2B3C4D5E6F7A8B9/',
      'https://www.upwork.com/nx/find-work/best-matches/details/~01a2b3c4d5e6f7a8b9?pageTitle=Job',
      'https://www.upwork.com/nx/proposals/job/~01a2b3c4d5e6f7a8b9/apply/',
      'https://www.upwork.com/nx/search/jobs/details/%7E01a2b3c4d5e6f7a8b9',
    ])
      expect(upworkJobUrl(link)).toBe(want);
  });

  it('turns down links that are not a job post', () => {
    expect(
      upworkJobUrl('https://www.upwork.com/nx/search/jobs/?q=angular'),
    ).toBe(null);
    expect(upworkJobUrl('https://www.upwork.com/freelancers/~01a2b3')).toBe(
      null,
    );
    expect(upworkJobUrl('https://example.com/jobs/~01a2b3c4d5e6f7a8b9')).toBe(
      null,
    );
  });

  it('builds a search link from the title, or two skills without one', () => {
    expect(upworkSearchUrl('Senior Angular Developer', ['RxJS'])).toBe(
      'https://www.upwork.com/nx/search/jobs/?q=Senior%20Angular%20Developer&sort=recency',
    );
    expect(upworkSearchUrl('', ['Angular', 'Tailwind', 'RxJS'])).toBe(
      'https://www.upwork.com/nx/search/jobs/?q=Angular%20Tailwind&sort=recency',
    );
    expect(upworkSearchUrl('  ')).toBe(
      'https://www.upwork.com/nx/search/jobs/',
    );
  });
});

describe('reading a pasted job post', () => {
  it('finds the fields Upwork shows, without a model', () => {
    const g = heuristicGig(PASTED);
    expect(g.title).toBe('Angular developer for an analytics dashboard');
    expect(g.budgetType).toBe('hourly');
    expect([g.rateMin, g.rateMax]).toEqual([35, 60]);
    expect(g.budget).toBe(null);
    expect(g.connects).toBe(14);
    expect(g.paymentVerified).toBe(true);
    expect(g.experienceLevel).toBe('expert');
    expect(g.duration).toBe('3 to 6 months');
    expect(g.clientCountry).toBe('Germany');
    expect(g.questions).toEqual([
      'Describe your recent experience with similar projects',
      'Which Angular version did you last ship to production?',
    ]);
  });

  it('reads a fixed-price post and an unverified client', () => {
    const g = heuristicGig(
      'Fix the checkout page of a WordPress shop\nThe cart total is wrong on mobile and the pay button overlaps the footer.\n$250.00\nFixed-price\nIntermediate\nAbout the client\nPayment method not verified\nUnited States',
    );
    expect(g.budgetType).toBe('fixed');
    expect(g.budget).toBe(250);
    expect(g.rateMin).toBe(null);
    expect(g.paymentVerified).toBe(false);
    expect(g.experienceLevel).toBe('intermediate');
    expect(g.clientCountry).toBe('United States');
    expect(g.questions).toEqual([]);
  });

  it('leaves what the text does not say empty', () => {
    const g = heuristicGig(
      'Need help with a small script\nPlease get in touch.',
    );
    expect(g).toMatchObject({
      ...emptyGig(),
      title: 'Need help with a small script',
    });
  });

  it('parses a model reply and drops what is not allowed', () => {
    const g = parseGig(
      'Here you go:\n{"title":"Angular dashboard","budgetType":"fixed","rateMin":30,"budget":"1,200","connects":16,"clientCountry":"Canada","paymentVerified":true,"experienceLevel":"Expert","duration":"1 to 3 months","skills":["Angular"," ",7,"RxJS"],"questions":["Why you?"]}',
    );
    expect(g).toEqual({
      budgetType: 'fixed',
      rateMin: null,
      rateMax: null,
      budget: 1200,
      connects: 16,
      clientCountry: 'Canada',
      paymentVerified: true,
      experienceLevel: 'expert',
      duration: '1 to 3 months',
      title: 'Angular dashboard',
      skills: ['Angular', 'RxJS'],
      questions: ['Why you?'],
    });
    expect(parseGig('no json here')).toBe(null);
  });

  it('asks the model for the pasted text only', () => {
    const p = gigPrompt(PASTED);
    expect(p).toContain('Angular developer for an analytics dashboard');
    expect(p).toContain('never guess a number');
  });
});

describe('gig details', () => {
  it('cleans values from anywhere', () => {
    expect(
      normaliseGig({
        budgetType: 'hourly',
        rateMin: 60,
        rateMax: 35,
        budget: 900,
        connects: -1,
        paymentVerified: 'yes',
        experienceLevel: 'guru',
      }),
    ).toEqual({
      ...emptyGig(),
      budgetType: 'hourly',
      rateMin: 35,
      rateMax: 60,
    });
    expect(normaliseGig(null)).toEqual(emptyGig());
    expect(normaliseGig([1, 2])).toEqual(emptyGig());
  });

  it('is null on a job and on rows from before the migration', () => {
    expect(gigOf({ entry_kind: 'job', gig: {} })).toBe(null);
    expect(gigOf({})).toBe(null);
    expect(gigOf({ entry_kind: 'gig', gig: { budgetType: 'fixed' } })).toEqual({
      ...emptyGig(),
      budgetType: 'fixed',
    });
  });

  it('words the budget', () => {
    const g = emptyGig();
    expect(gigBudgetLine(g)).toBe('');
    expect(gigBudgetLine({ ...g, budgetType: 'hourly' })).toBe('Hourly');
    expect(
      gigBudgetLine({ ...g, budgetType: 'hourly', rateMin: 25, rateMax: 40 }),
    ).toBe('$25–$40/hr');
    expect(gigBudgetLine({ ...g, budgetType: 'hourly', rateMax: 40 })).toBe(
      '$40/hr',
    );
    expect(gigBudgetLine({ ...g, budgetType: 'fixed', budget: 1200 })).toBe(
      '$1,200 fixed price',
    );
    expect(gigBudgetLine({ ...g, budgetType: 'fixed' })).toBe('Fixed price');
  });

  it('accepts a checked draft and names what is missing', () => {
    const draft = {
      ...emptyGig(),
      url: 'https://www.upwork.com/jobs/Angular_~01a2b3c4d5e6f7a8b9/',
      title: 'Angular dashboard',
      skills: ['Angular'],
      questions: [],
      postingText: PASTED,
    };
    expect(checkGigDraft(draft)).toMatchObject({
      url: 'https://www.upwork.com/jobs/~01a2b3c4d5e6f7a8b9',
      title: 'Angular dashboard',
    });
    expect(checkGigDraft({ ...draft, url: 'https://example.com/x' })).toEqual({
      error: expect.stringContaining('Upwork'),
    });
    expect(checkGigDraft({ ...draft, title: ' ' })).toEqual({
      error: 'Give the job a title',
    });
    expect(checkGigDraft({ ...draft, postingText: 'short' })).toEqual({
      error: 'Paste the text of the job post',
    });
  });
});

describe('proposals', () => {
  const resume = {
    ...emptyResume(),
    contact: {
      ...emptyResume().contact,
      name: 'Sam Rivera',
      headline: 'Senior Frontend Engineer',
    },
    summary: 'Frontend engineer with 12 years of experience.',
    skills: [{ label: 'Frontend', items: ['Angular', 'TypeScript', 'RxJS'] }],
    experience: [
      {
        ...emptyResume().experience[0],
        title: 'Senior Frontend Engineer',
        company: 'Northwind',
        bullets: [
          'Rebuilt the reporting dashboard in Angular, cutting load time by 40%.',
          'Led 4 engineers on the design-system migration.',
        ],
      },
    ],
  };
  const ctx = {
    resume,
    posting: {
      company: 'Upwork client',
      title: 'Angular developer for an analytics dashboard',
      text: PASTED,
      stack: ['Angular', 'Tailwind'],
    },
  };

  it('asks for a short proposal that never names a price', () => {
    const p = proposalPrompt(ctx, {
      ...emptyGig(),
      budgetType: 'hourly',
      rateMin: 35,
      rateMax: 60,
      duration: '3 to 6 months',
    });
    expect(p).toContain('proposal for this freelance job on Upwork');
    expect(p).toContain('Do not mention a price');
    expect(p).toContain('Budget: $35–$60/hr');
    expect(p).toContain('Length: 3 to 6 months');
    expect(p).not.toContain('Upwork client');
  });

  it('writes a local proposal from the resume alone', () => {
    const text = localProposal(ctx);
    expect(text.startsWith('Hi,')).toBe(true);
    expect(text).toContain('Angular developer for an analytics dashboard');
    expect(text).toContain('I work with Angular every day');
    expect(text).toContain('cutting load time by 40%');
    expect(text).not.toMatch(/\[|\$/);
  });
});
