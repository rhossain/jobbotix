import { deepStrictEqual as assertEquals } from 'node:assert';
import { fillFromPost, type StoredPost } from './post-fill.ts';

const IMPORTED: StoredPost = {
  company: 'Acme',
  title: 'Senior Angular Engineer',
  location: '',
  remote_scope: '',
  type: 'full_time',
  salary: '',
  stack: [],
  posted_at: null,
  posting_text: '',
};
const READ = {
  company: 'Acme Corporation',
  title: 'Sr. Angular Engineer (Remote)',
  location: 'Remote, worldwide',
  type: 'contract' as const,
  salary: '$90k-$120k',
  stack: ['Angular', 'RxJS'],
  postingText: 'The whole post.',
};

Deno.test('a pasted post fills the blanks of an imported job', () => {
  assertEquals(fillFromPost(IMPORTED, READ, '2026-11-01', true), {
    // the company and title from the user's own file stay as they are
    company: 'Acme',
    title: 'Senior Angular Engineer',
    location: 'Remote, worldwide',
    remote_scope: 'Remote, worldwide',
    type: 'contract',
    salary: '$90k-$120k',
    stack: ['Angular', 'RxJS'],
    posted_at: '2026-11-01',
    posting_text: 'The whole post.',
  });
});

Deno.test('it never overwrites what the job already says', () => {
  const edited: StoredPost = {
    ...IMPORTED,
    location: 'Dhaka',
    remote_scope: 'Bangladesh only',
    salary: 'BDT 250k',
    stack: ['Vue'],
    posted_at: '2026-10-20',
  };
  assertEquals(fillFromPost(edited, READ, '2026-11-01', true), {
    ...edited,
    type: 'contract',
    posting_text: 'The whole post.',
  });
});

Deno.test('the pattern reader does not change the job type', () => {
  assertEquals(
    fillFromPost({ ...IMPORTED, type: 'freelance' }, READ, null, false).type,
    'freelance',
  );
});

Deno.test('placeholder names are replaced, real ones are not', () => {
  const r = fillFromPost(
    { ...IMPORTED, company: 'Unknown company', title: 'Untitled role' },
    READ,
    null,
    false,
  );
  assertEquals(
    [r.company, r.title],
    ['Acme Corporation', 'Sr. Angular Engineer (Remote)'],
  );
  const empty = fillFromPost(
    { ...IMPORTED, company: 'Unknown company' },
    { ...READ, company: '' },
    null,
    false,
  );
  assertEquals(empty.company, 'Unknown company');
});
