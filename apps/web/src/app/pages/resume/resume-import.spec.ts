import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { emptyResume } from '@jobbotix/shared-types';
import { strToU8, zipSync } from 'fflate';
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
    expect(p.parseLabel()).toBe('Read my resume');
    await p.parse();
    expect(asked).toEqual([]);
    expect(p.source()).toBe('local');
    expect(p.result()?.resume.contact.name).toBe('Rafi Ahmed');
    expect(p.parseLabel()).toBe('Read again');
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

describe('ResumeImportPanel: a LinkedIn file', () => {
  const zipFile = (files: Record<string, string>) => {
    const bytes = zipSync(
      Object.fromEntries(
        Object.entries(files).map(([n, t]) => [`Export/${n}`, strToU8(t)]),
      ),
    );
    return {
      name: 'Basic_LinkedInDataExport.zip',
      size: bytes.length,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    } as unknown as File;
  };

  it('fills the result from the profile files, in the browser', async () => {
    const { p, asked } = panel({});
    p.mode.set('ai');
    await p.onFile(
      zipFile({
        'Profile.csv':
          'First Name,Last Name,Headline,Summary,Geo Location\nAlex,Morgan,Senior Frontend Engineer,Builds dashboards.,"Dhaka, Bangladesh"\n',
        'Positions.csv':
          'Company Name,Title,Description,Location,Started On,Finished On\nNorthwind,Senior Frontend Engineer,Rebuilt the dashboard.,Remote,Mar 2021,\n',
        'Skills.csv': 'Name\nAngular\nTypeScript\n',
        'messages.csv': 'FROM,TO,CONTENT\na,b,private',
      }),
    );
    // read by the built-in reader even with AI picked: nothing is sent
    expect(asked).toEqual([]);
    expect(p.error()).toBe('');
    expect(p.source()).toBe('local');
    const r = p.result();
    expect(r?.resume.contact.name).toBe('Alex Morgan');
    expect(r?.resume.experience[0]).toMatchObject({
      company: 'Northwind',
      start: '2021-03',
      end: '',
    });
    expect(r?.resume.skills).toEqual([
      { name: 'Skills', items: ['Angular', 'TypeScript'] },
    ]);
    expect(r?.warnings[0]).toContain('Read from your LinkedIn file');
    expect(JSON.stringify(r)).not.toContain('private');
  });

  it('says so when the ZIP holds no profile', async () => {
    const { p } = panel({});
    await p.onFile(zipFile({ 'notes.txt': 'hello' }));
    expect(p.result()).toBeNull();
    expect(p.error()).toContain('no LinkedIn profile');
    await p.onFile(
      zipFile({
        'Connections.csv':
          'First Name,Last Name,URL,Email Address,Company,Position,Connected On\nDana,W,,,Acme,EM,17 Nov 2025\n',
      }),
    );
    expect(p.result()).toBeNull();
    expect(p.error()).toContain('no LinkedIn profile');
  });
});
