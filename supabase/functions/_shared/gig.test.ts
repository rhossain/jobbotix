import { deepStrictEqual as assertEquals } from 'node:assert';
import {
  checkGigDraft,
  emptyGig,
  gigBudgetLine,
  gigOf,
  heuristicGig,
  isUpworkUrl,
  parseGig,
  upworkJobUrl,
} from './gig.ts';

const PASTED = `Angular developer for an analytics dashboard
Posted 2 hours ago

We need a senior Angular developer to rebuild our analytics dashboard.

Expert
Experience Level
$35.00 - $60.00
Hourly

You will be asked to answer the following questions when submitting a proposal:
1. Describe your recent experience with similar projects

About the client
Payment method verified
Germany

Send a proposal for: 14 Connects`;

Deno.test('an Upwork page is recognised so it is never fetched', () => {
  assertEquals(
    isUpworkUrl('https://www.upwork.com/jobs/~01a2b3c4d5e6f7a8b9'),
    true,
  );
  assertEquals(isUpworkUrl('https://community.upwork.com/t5/x'), true);
  assertEquals(
    isUpworkUrl('https://upwork.com.evil.example/jobs/~01a2b3c4d5e6'),
    false,
  );
  assertEquals(isUpworkUrl('https://boards.greenhouse.io/acme/jobs/1'), false);
});

Deno.test('job links collapse to one address; other links are refused', () => {
  assertEquals(
    upworkJobUrl(
      'https://www.upwork.com/freelance-jobs/apply/Angular_~01A2B3C4D5E6F7A8B9/',
    ),
    'https://www.upwork.com/jobs/~01a2b3c4d5e6f7a8b9',
  );
  assertEquals(
    upworkJobUrl('https://www.upwork.com/nx/search/jobs/?q=angular'),
    null,
  );
  assertEquals(
    upworkJobUrl('https://example.com/jobs/~01a2b3c4d5e6f7a8b9'),
    null,
  );
});

Deno.test('the pattern reader fills a gig from pasted text', () => {
  const g = heuristicGig(PASTED);
  assertEquals(g.title, 'Angular developer for an analytics dashboard');
  assertEquals([g.budgetType, g.rateMin, g.rateMax], ['hourly', 35, 60]);
  assertEquals(
    [g.connects, g.paymentVerified, g.clientCountry],
    [14, true, 'Germany'],
  );
  assertEquals(g.questions, [
    'Describe your recent experience with similar projects',
  ]);
  assertEquals(gigBudgetLine(g), '$35–$60/hr');
});

Deno.test('a model reply is cleaned before it is used', () => {
  const g = parseGig(
    '{"title":"T","budgetType":"fixed","budget":"900","rateMin":20,"skills":["Angular",3],"questions":[]}',
  );
  assertEquals(g?.budget, 900);
  assertEquals(g?.rateMin, null);
  assertEquals(g?.skills, ['Angular']);
});

Deno.test(
  'a draft is saved only with an Upwork job link, a title and the text',
  () => {
    const draft = {
      ...emptyGig(),
      url: 'https://www.upwork.com/jobs/~01a2b3c4d5e6f7a8b9',
      title: 'Angular dashboard',
      skills: [],
      questions: [],
      postingText: PASTED,
    };
    assertEquals('error' in checkGigDraft(draft), false);
    assertEquals(
      'error' in checkGigDraft({ ...draft, url: 'https://example.com/job/1' }),
      true,
    );
    assertEquals('error' in checkGigDraft({ ...draft, postingText: '' }), true);
  },
);

Deno.test('a job has no gig details', () => {
  assertEquals(gigOf({ entry_kind: 'job', gig: {} }), null);
  assertEquals(gigOf({ url: 'x' } as never), null);
});
