import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { normaliseResume } from './resume.ts';
import {
  hasReviewableText,
  parseReviewReply,
  reviewable,
  reviewPrompt,
} from './resume-review.ts';

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
  summary: 'I am a hard-working engineer who has worked on various things.',
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
});

Deno.test('the model is sent the wording, not the contact details', () => {
  const prompt = reviewPrompt(MASTER);
  for (const secret of [
    'Rafi Ahmed',
    'rafi@example.com',
    '+880',
    'github.com/rafi',
    'rafi.example',
  ])
    assert(!prompt.includes(secret), secret);
  assert(prompt.includes('Senior Frontend Engineer'));
  assert(prompt.includes('Responsible for the dashboard'));
  // Indexes are unchanged, so the paths in the reply fit the real resume.
  const sent = reviewable(MASTER) as typeof MASTER;
  assertEquals(sent.experience, MASTER.experience);
  assertEquals(sent.projects, MASTER.projects);
});

Deno.test(
  'parseReviewReply: rewrites and removals of fields that exist',
  () => {
    const reply = `Here is the review:
[
  {"path": "summary", "kind": "replace", "before": "x", "after": "Senior frontend engineer with six years on data-heavy dashboards.", "reason": "Generic and first person"},
  {"path": "experience.0.bullets.0", "kind": "replace", "before": "Responsible for the dashboard", "after": "Own the customer dashboard used across 140 screens", "reason": "States a duty"},
  {"path": "experience.0.bullets.1", "kind": "remove", "before": "", "after": "", "reason": "Repeats"}
]`;
    const changes = parseReviewReply(reply, MASTER)!;
    assertEquals(
      changes.map((c) => [c.path, c.kind]),
      [
        ['summary', 'replace'],
        ['experience.0.bullets.0', 'replace'],
        ['experience.0.bullets.1', 'remove'],
      ],
    );
    // "before" is what the resume says, whatever the model wrote there.
    assertEquals(changes[0].before, MASTER.summary);
    assertEquals(changes[0].reason, 'Generic and first person');
  },
);

Deno.test(
  'parseReviewReply: nothing is added, moved off-limits or left unchanged',
  () => {
    const reply = JSON.stringify([
      // an invented bullet and an invented skill
      { path: 'experience.0.bullets', kind: 'add', after: 'Led a team of 12' },
      { path: 'skills.0.items', kind: 'add', after: 'Kubernetes' },
      // fields a review may not touch
      { path: 'experience.0.company', kind: 'replace', after: 'Google' },
      { path: 'experience.0.start', kind: 'replace', after: '2015-01' },
      { path: 'contact.email', kind: 'replace', after: 'x@example.com' },
      // a path the resume does not have
      { path: 'experience.4.bullets.0', kind: 'replace', after: 'Something' },
      // a rewrite that changes nothing
      {
        path: 'projects.0.description',
        kind: 'replace',
        after: 'A UI library.',
      },
    ]);
    assertEquals(parseReviewReply(reply, MASTER), []);
  },
);

Deno.test(
  'parseReviewReply: "nothing to change" is not the same as unreadable',
  () => {
    assertEquals(parseReviewReply('[]', MASTER), []);
    assertEquals(parseReviewReply('The resume is strong: []', MASTER), []);
    assertEquals(parseReviewReply('Looks great to me!', MASTER), null);
    assertEquals(parseReviewReply('[{"path": "summary",', MASTER), null);
  },
);

Deno.test('hasReviewableText: an empty resume has nothing to review', () => {
  assert(hasReviewableText(MASTER));
  assert(!hasReviewableText(normaliseResume({})));
  assert(
    !hasReviewableText(
      normaliseResume({ contact: { name: 'Rafi' }, skills: MASTER.skills }),
    ),
  );
});
