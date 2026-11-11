import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ProfileRow } from '@jobbotix/shared-types';
import { Auth } from './auth';
import { SettingsRepo } from './data/repos';
import { Plan } from './plan';
import { ResumeTemplateChoice } from './resume-template';

function setup(opts: {
  extras?: boolean;
  profileTemplate?: string;
  save?: (patch: { resume_template?: string }) => Promise<void>;
}) {
  const profile = signal<Partial<ProfileRow> | null>(
    opts.profileTemplate ? { resume_template: opts.profileTemplate } : {},
  );
  const saved: string[] = [];
  const offered: string[] = [];
  TestBed.configureTestingModule({
    providers: [
      { provide: Auth, useValue: { profile: signal(null) } },
      {
        provide: SettingsRepo,
        useValue: {
          profile,
          updateProfile: async (patch: { resume_template?: string }) => {
            if (opts.save) await opts.save(patch);
            saved.push(patch.resume_template ?? '');
            profile.update((p) => ({ ...p, ...patch }));
          },
        },
      },
      {
        provide: Plan,
        useValue: {
          can: () => opts.extras ?? true,
          offer: async (f: string) => void offered.push(f),
        },
      },
    ],
  });
  return { choice: TestBed.inject(ResumeTemplateChoice), saved, offered };
}

describe('ResumeTemplateChoice', () => {
  beforeEach(() => localStorage.clear());

  it('starts on Classic and keeps a choice on the profile', async () => {
    const { choice, saved } = setup({});
    expect(choice.template().id).toBe('classic');
    expect(await choice.choose('modern')).toBe(true);
    expect(saved).toEqual(['modern']);
    expect(choice.template().id).toBe('modern');
  });

  it('uses what the profile says over what this browser remembers', () => {
    localStorage.setItem('jobbotix.resume-template', 'compact');
    expect(setup({ profileTemplate: 'serif' }).choice.template().id).toBe(
      'serif',
    );
  });

  it('keeps the choice on the device when the server cannot store it yet', async () => {
    const { choice } = setup({
      save: () =>
        Promise.reject(
          new Error("Could not find the 'resume_template' column"),
        ),
    });
    expect(await choice.choose('banner')).toBe(true);
    expect(choice.template().id).toBe('banner');
    expect(localStorage.getItem('jobbotix.resume-template')).toBe('banner');
  });

  it('offers the plan, and changes nothing, for a template the plan does not cover', async () => {
    const { choice, saved, offered } = setup({ extras: false });
    expect(choice.locked(choice.all[1])).toBe(true);
    expect(choice.locked(choice.all[0])).toBe(false);
    expect(await choice.choose('modern')).toBe(false);
    expect(offered).toEqual(['extra_templates']);
    expect(saved).toEqual([]);
    expect(choice.template().id).toBe('classic');
  });

  it('falls back to Classic when a plan that covered the choice has lapsed', () => {
    const { choice } = setup({ extras: false, profileTemplate: 'serif' });
    expect(choice.chosen().id).toBe('serif');
    expect(choice.template().id).toBe('classic');
  });
});
