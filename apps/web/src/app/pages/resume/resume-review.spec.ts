import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  emptyResume,
  type ResumeSections,
  type VariantChange,
} from '@jobbotix/shared-types';
import { ResumesRepo, SettingsRepo } from '../../core/data/repos';
import { sampleReview } from '../../core/data/sample-review';
import { Plan } from '../../core/plan';
import {
  ResumeReviewPanel,
  reviewLabel,
  stillFitting,
  textAt,
} from './resume-review';

const RESUME: ResumeSections = {
  ...emptyResume(),
  summary: 'I am an engineer.',
  experience: [
    {
      title: 'Senior Frontend Engineer',
      company: 'Northwind',
      location: '',
      start: '2020-01',
      end: '',
      bullets: ['Responsible for the dashboard', 'Cut the bundle by 38%'],
    },
  ],
  projects: [
    { name: 'Styloviz', url: '', description: 'A library', stack: [] },
  ],
};

const change = (over: Partial<VariantChange>): VariantChange => ({
  id: 'c1',
  path: 'summary',
  kind: 'replace',
  before: 'I am an engineer.',
  after: 'Frontend engineer with six years on dashboards.',
  reason: 'First person and generic',
  decision: 'pending',
  ...over,
});

function panel(opts: {
  connections?: number;
  answer?: () => Promise<VariantChange[]>;
}) {
  const asked: { sections: ResumeSections; model?: string }[] = [];
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ResumesRepo,
        useValue: {
          reviewWithAi: async (sections: ResumeSections, model?: string) => {
            asked.push({ sections, model });
            return {
              changes: opts.answer
                ? await opts.answer()
                : [
                    change({}),
                    change({
                      id: 'c2',
                      path: 'experience.0.bullets.0',
                      before: 'Responsible for the dashboard',
                      after: 'Own the customer dashboard',
                    }),
                  ],
              model: 'gemini-3.8-flash',
            };
          },
        },
      },
      {
        provide: SettingsRepo,
        useValue: {
          connections: signal(new Array(opts.connections ?? 1).fill({})),
          load: async () => undefined,
        },
      },
      {
        provide: Plan,
        useValue: { route: signal({ enabled: false, ownOnly: false }) },
      },
    ],
  });
  const fixture = TestBed.createComponent(ResumeReviewPanel);
  const sections = signal(RESUME);
  fixture.componentRef.setInput('sections', sections());
  const set = (next: ResumeSections) => {
    sections.set(next);
    fixture.componentRef.setInput('sections', next);
  };
  return { p: fixture.componentInstance, asked, set };
}

describe('textAt, reviewLabel, stillFitting', () => {
  it('reads the field a change points at', () => {
    expect(textAt(RESUME, 'summary')).toBe('I am an engineer.');
    expect(textAt(RESUME, 'experience.0.bullets.1')).toBe(
      'Cut the bundle by 38%',
    );
    expect(textAt(RESUME, 'experience.3.bullets.0')).toBeNull();
    expect(textAt(RESUME, 'experience.0.bullets')).toBeNull();
  });

  it('names where a change is in the words on the page', () => {
    expect(reviewLabel(RESUME, 'summary')).toBe('Summary');
    expect(reviewLabel(RESUME, 'contact.headline')).toBe('Headline');
    expect(reviewLabel(RESUME, 'experience.0.bullets.1')).toBe(
      'Experience · Northwind · bullet 2',
    );
    expect(reviewLabel(RESUME, 'projects.0.description')).toBe(
      'Project · Styloviz',
    );
  });

  it('keeps only accepted changes whose text has not been edited since', () => {
    const accepted = change({ decision: 'accepted' });
    expect(stillFitting(RESUME, [accepted, change({ id: 'p' })])).toEqual([
      accepted,
    ]);
    const edited = { ...RESUME, summary: 'I rewrote this myself.' };
    expect(stillFitting(edited, [accepted])).toEqual([]);
  });
});

describe('ResumeReviewPanel', () => {
  it('reviews what is in the editor and waits for a decision on each change', async () => {
    const { p, asked } = panel({});
    p.model.set('groq:openai/gpt-oss-120b');
    await p.review();
    expect(asked).toEqual([
      { sections: RESUME, model: 'groq:openai/gpt-oss-120b' },
    ]);
    expect(p.changes()?.map((c) => c.decision)).toEqual(['pending', 'pending']);
    expect(p.reviewedBy()).toBe('gemini-3.8-flash');
    expect(p.acceptedCount()).toBe(0);
    expect(p.applyLabel()).toBe('Accept a change to apply it');
  });

  it('applies only what was accepted', async () => {
    const { p } = panel({});
    const out: { changes: VariantChange[]; stale: number }[] = [];
    p.applied.subscribe((e) => out.push(e));
    await p.review();
    const [summary, bullet] = p.changes() ?? [];
    p.decide(summary, 'accepted');
    p.decide(bullet, 'rejected');
    expect(p.applyLabel()).toBe('Apply 1 accepted change');
    p.apply();
    expect(out.map((e) => [e.changes.map((c) => c.id), e.stale])).toEqual([
      [['c1'], 0],
    ]);
    // Pressing Accept again takes the decision back.
    p.decide((p.changes() ?? [])[0], 'accepted');
    expect(p.changes()?.[0].decision).toBe('pending');
  });

  it('leaves out a change whose text was edited after the review', async () => {
    const { p, set } = panel({});
    const out: { changes: VariantChange[]; stale: number }[] = [];
    p.applied.subscribe((e) => out.push(e));
    await p.review();
    p.decideAll('accepted');
    set({ ...RESUME, summary: 'I rewrote this myself.' });
    p.apply();
    expect(out[0].changes.map((c) => c.id)).toEqual(['c2']);
    expect(out[0].stale).toBe(1);
  });

  it('says so when the model has nothing to change, and when it fails', async () => {
    const none = panel({ answer: async () => [] });
    await none.p.review();
    expect(none.p.changes()).toEqual([]);

    TestBed.resetTestingModule();
    const failed = panel({
      answer: () => Promise.reject(new Error('Groq is rate limited.')),
    });
    await failed.p.review();
    expect(failed.p.changes()).toBeNull();
    expect(failed.p.error()).toBe('Groq is rate limited.');
  });

  it('asks nothing of a model on an account with no way to pay for it', async () => {
    const { p, asked } = panel({ connections: 0 });
    await p.review();
    expect(asked).toEqual([]);
  });
});

describe('sampleReview (demo mode)', () => {
  it('only rewrites what is there', () => {
    const long = {
      ...RESUME,
      summary: `${'Senior engineer with fifteen years of Angular. '.repeat(4)}Works AI-first with Claude and Cursor every day on real products.`,
    };
    const changes = sampleReview(long);
    expect(changes.map((c) => [c.path, c.kind])).toEqual([
      ['summary', 'replace'],
      ['experience.0.bullets.0', 'replace'],
    ]);
    expect(changes[1].after).toBe('Owned the dashboard');
    for (const c of changes) expect(textAt(long, c.path)).toBe(c.before);
    expect(sampleReview(emptyResume())).toEqual([]);
  });
});
