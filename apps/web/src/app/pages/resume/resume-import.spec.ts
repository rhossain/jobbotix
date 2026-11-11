import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { emptyResume } from '@jobbotix/shared-types';
import { ResumesRepo, SettingsRepo } from '../../core/data/repos';
import { Plan } from '../../core/plan';
import { ResumeImportPanel } from './resume-import';

const TEXT = `Rafi Ahmed
Senior Frontend Engineer
rafi@example.com

Experience
Senior Frontend Engineer, Northwind Analytics
Jan 2020 - Present
- Led the move of a 140-screen dashboard to Angular`;

function panel(opts: { connections?: number; ai?: () => Promise<unknown> }) {
  const asked: { text: string; model?: string }[] = [];
  const fromAi = {
    ...emptyResume(),
    contact: { ...emptyResume().contact, name: 'Read By Model' },
  };
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ResumesRepo,
        useValue: {
          readWithAi: async (text: string, model?: string) => {
            asked.push({ text, model });
            if (opts.ai) await opts.ai();
            return { resume: fromAi, warnings: [], model: 'gemini-3.8-flash' };
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
  const p = TestBed.runInInjectionContext(() => new ResumeImportPanel());
  p.text.set(TEXT);
  return { p, asked };
}

describe('ResumeImportPanel: how a resume is read', () => {
  it('uses the built-in reader unless AI is picked, and sends nothing', async () => {
    const { p, asked } = panel({});
    expect(p.mode()).toBe('local');
    expect(p.parseLabel()).toBe('Parse');
    await p.parse();
    expect(asked).toEqual([]);
    expect(p.source()).toBe('local');
    expect(p.result()?.resume.contact.name).toBe('Rafi Ahmed');
    expect(p.parseLabel()).toBe('Parse again');
  });

  it('reads with AI when that is picked, on the model chosen', async () => {
    const { p, asked } = panel({});
    p.mode.set('ai');
    p.model.set('gemini:gemini-3.8-flash');
    expect(p.parseLabel()).toBe('Read with AI');
    await p.parse();
    expect(asked).toEqual([
      { text: TEXT.trim(), model: 'gemini:gemini-3.8-flash' },
    ]);
    expect(p.source()).toBe('ai');
    expect(p.result()?.resume.contact.name).toBe('Read By Model');
    expect(p.aiModel()).toBe('gemini-3.8-flash');
    // The built-in result is kept, so the AI read can be undone.
    p.useLocal();
    expect(p.result()?.resume.contact.name).toBe('Rafi Ahmed');
  });

  it('shows no result while the model is reading', async () => {
    let release: () => void = () => undefined;
    const { p } = panel({ ai: () => new Promise<void>((r) => (release = r)) });
    p.mode.set('ai');
    const reading = p.parse();
    await Promise.resolve();
    expect(p.aiBusy()).toBe(true);
    expect(p.result()).toBeNull();
    expect(p.parseLabel()).toBe('Reading…');
    release();
    await reading;
    expect(p.result()?.resume.contact.name).toBe('Read By Model');
  });

  it('falls back to the built-in result, and says why, when AI fails', async () => {
    const { p } = panel({
      ai: () => Promise.reject(new Error('Google Gemini is rate limited.')),
    });
    p.mode.set('ai');
    await p.parse();
    expect(p.source()).toBe('local');
    expect(p.result()?.resume.contact.name).toBe('Rafi Ahmed');
    expect(p.aiError()).toBe(
      "Google Gemini is rate limited. This is the built-in reader's result instead.",
    );
  });

  it('never reads with AI on an account with no way to pay for it', async () => {
    const { p, asked } = panel({ connections: 0 });
    expect(p.hasKey()).toBe(false);
    p.mode.set('ai');
    await p.parse();
    expect(asked).toEqual([]);
    expect(p.source()).toBe('local');
  });
});
