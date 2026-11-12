import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { letterPrompt } from './letter.ts';
import { prepPrompt } from './prep.ts';
import { normaliseResume } from './resume.ts';
import { resumeContext, resumeForModel } from './resume-context.ts';
import { reviewPrompt } from './resume-review.ts';
import { screeningPrompt } from './screening.ts';
import { tailorPrompt } from './variant.ts';

const MASTER = normaliseResume({
  contact: {
    name: 'Rafi Ahmed',
    headline: 'Senior Frontend Engineer',
    email: 'rafi@example.com',
    phone: '+880 1700 000000',
    location: 'Dhaka',
    website: 'https://rafi.example',
    links: [{ label: 'GitHub', url: 'https://github.com/rafi' }],
  },
  summary: 'Frontend engineer, six years on data-heavy dashboards.',
  experience: [
    {
      title: 'Senior Frontend Engineer',
      company: 'Northwind Analytics',
      location: 'Remote',
      start: '2020-01',
      end: '',
      bullets: [
        'Responsible for the dashboard',
        'Cut the main bundle by 38% by moving 140 screens to Angular signals',
      ],
    },
  ],
  skills: [{ name: 'Frontend', items: ['Angular', 'TypeScript'] }],
  projects: [
    { name: 'Styloviz', url: '', description: 'A UI library.', stack: [] },
  ],
  aiToolkit: ['Claude Code'],
});
const POSTING = {
  company: 'Globex',
  title: 'Angular Developer',
  text: 'We need Angular and RxJS.',
  stack: ['Angular', 'RxJS'],
};

Deno.test('the model is sent the wording, not the contact details', () => {
  const context = resumeContext(MASTER);
  for (const secret of [
    'Rafi Ahmed',
    'rafi@example.com',
    '+880',
    'github.com/rafi',
    'rafi.example',
    'Dhaka',
  ])
    assert(!context.includes(secret), secret);
  assert(context.startsWith('RESUME (JSON).'));
  assert(context.includes('Senior Frontend Engineer'));
  assert(context.includes('Cut the main bundle by 38%'));
  assert(context.includes('Claude Code'));
  // Indexes are unchanged, so the paths in a reply fit the real resume.
  const sent = resumeForModel(MASTER) as typeof MASTER;
  assertEquals(sent.experience, MASTER.experience);
  assertEquals(sent.projects, MASTER.projects);
  assertEquals(sent.skills, MASTER.skills);
});

Deno.test(
  'the context is the same text however the resume was put together',
  () => {
    // The same resume with its keys in another order, as a stored JSON
    // document can come back: the cache only helps if the text is identical.
    const shuffled = Object.fromEntries(
      Object.entries(MASTER).reverse(),
    ) as typeof MASTER;
    assertEquals(resumeContext(shuffled), resumeContext(MASTER));
    // And a different resume is a different text.
    assert(
      resumeContext({ ...MASTER, summary: 'Something else.' }) !==
        resumeContext(MASTER),
    );
  },
);

Deno.test(
  'every resume job refers to the resume above and carries none of it',
  () => {
    const tasks = {
      tailor: tailorPrompt(POSTING),
      review: reviewPrompt(),
      letter: letterPrompt({ resume: MASTER, posting: POSTING }),
      prep: prepPrompt(MASTER, POSTING),
      answer: screeningPrompt({
        resume: MASTER,
        posting: POSTING,
        questions: [{ id: 'q1', question: 'Years of Angular?' }],
      }),
    };
    for (const [job, prompt] of Object.entries(tasks)) {
      assert(prompt.includes('RESUME above'), `${job} does not point at it`);
      assert(
        !prompt.includes('Cut the main bundle by 38%'),
        `${job} repeats the resume`,
      );
      assert(!prompt.includes('rafi@example.com'), `${job} sends the email`);
    }
    // The jobs that address the person still name them, in the task.
    assert(tasks.letter.includes('Candidate: Rafi Ahmed'));
    assert(tasks.answer.includes('based in Dhaka'));
  },
);
