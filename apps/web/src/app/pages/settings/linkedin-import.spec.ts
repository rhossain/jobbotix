import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { strToU8, zipSync } from 'fflate';
import {
  AccountDataRepo,
  LinkedInRepo,
  RolesRepo,
} from '../../core/data/repos';
import { MemoryLinkedInRepo } from '../../core/data/linkedin-repos';
import type { PickedFile } from '../../shared/linkedin-archive';
import { Confirm } from '../../ui';
import { LinkedInImport } from './linkedin-import';

// Made-up files in the shape of LinkedIn's archive.
const SAVED = `Saved Date,Job Url,Job Title,Company Name
"11/14/26, 9:14 AM",https://www.linkedin.com/jobs/view/4012345678,Senior Angular Engineer,Acme
"11/10/26, 6:02 PM",https://www.linkedin.com/jobs/view/4033333333,Frontend Engineer,Initech
"11/09/26, 6:02 PM",https://www.linkedin.com/jobs/view/4044444444,UI Engineer,Hooli
`;
const APPLIED = `Application Date,Contact Email,Contact Phone Number,Company Name,Job Title,Job Url,Resume Name,Question And Answers
"11/12/26, 10:30 AM",recruiter@globex.example,+1 555 0100,Globex,Frontend Lead,https://www.linkedin.com/jobs/view/4099999999,cv.pdf,
`;
const CONNECTIONS = `Notes:
"Some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Dana,Whitfield,https://www.linkedin.com/in/dana-whitfield-example,dana@private.example,Acme,Engineering Manager,17 Nov 2025
Ravi,Menon,https://www.linkedin.com/in/ravi-menon-example,,Globex,Senior Recruiter,03 Jan 2024
`;
const PROFILE = `First Name,Last Name,Headline,Summary,Geo Location
Alex,Morgan,Senior Frontend Engineer,Builds dashboards.,"Dhaka, Bangladesh"
`;

function zip(files: Record<string, string>): PickedFile[] {
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries(files).map(([n, t]) => [`Export/${n}`, strToU8(t)]),
    ),
  );
  return [{ name: 'Export.zip', size: bytes.length, read: async () => bytes }];
}

async function setup(
  existing: { url: string; company: string; title: string }[] = [],
) {
  const importRoles = vi.fn().mockImplementation(async (l: unknown[]) => ({
    added: l.length,
    duplicates: 0,
    failed: 0,
  }));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AccountDataRepo, useValue: { importRoles } },
      {
        provide: RolesRepo,
        useValue: { roles: signal(existing), load: async () => undefined },
      },
      { provide: LinkedInRepo, useClass: MemoryLinkedInRepo },
    ],
  });
  const linkedin = TestBed.inject(LinkedInRepo) as MemoryLinkedInRepo;
  const fixture = TestBed.createComponent(LinkedInImport);
  const el: HTMLElement = fixture.nativeElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await settle();
  const open = async (picked: PickedFile[]) => {
    await fixture.componentInstance.open(picked);
    await settle();
  };
  const click = async (selector: string) => {
    (el.querySelector(selector) as HTMLElement).click();
    await settle();
  };
  return { fixture, el, importRoles, linkedin, open, click, settle };
}

describe('LinkedInImport', () => {
  it('shows what is in the archive and imports it', async () => {
    const { el, importRoles, linkedin, open, click } = await setup();
    await open(
      zip({
        'Jobs/Saved Jobs.csv': SAVED,
        'Jobs/Job Applications.csv': APPLIED,
        'Connections.csv': CONNECTIONS,
        'Profile.csv': PROFILE,
        'messages.csv': 'FROM,TO,CONTENT\na,b,private',
      }),
    );
    const preview = el.querySelector('#li-preview')?.textContent ?? '';
    expect(preview).toContain('4 jobs to add');
    expect(preview).toContain('Keep my 2 connections');
    expect(preview).toContain(
      '1 other file was in the archive and left unopened',
    );
    expect(el.querySelector('#li-resume')).not.toBeNull();
    expect(el.textContent).not.toContain('private');

    await click('#li-run');
    expect(importRoles).toHaveBeenCalledTimes(1);
    const sent = importRoles.mock.calls[0][0];
    expect(sent).toHaveLength(4);
    expect(sent[0]).toEqual({
      company: 'Globex',
      title: 'Frontend Lead',
      url: 'https://www.linkedin.com/jobs/view/4099999999/',
      status: 'applied',
      location: '',
      salary: '',
      notes: '',
      source: 'LinkedIn export',
      found_at: '2026-11-12T12:00:00.000Z',
      status_changed_at: '2026-11-12T12:00:00.000Z',
    });
    expect(sent[1]).toMatchObject({ company: 'Acme', status: 'shortlist' });
    // connections are kept without anyone's email address
    expect(linkedin.total()).toBe(2);
    const kept = await linkedin.search('');
    expect(kept.map((c) => c.name)).toEqual(['Dana Whitfield', 'Ravi Menon']);
    expect(JSON.stringify(kept)).not.toContain('private.example');
    expect(JSON.stringify(sent)).not.toContain('recruiter@');
    expect(el.querySelector('#li-preview')).toBeNull();
    expect(el.querySelector('#li-kept')?.textContent).toContain(
      '2 LinkedIn connections are kept',
    );
  });

  it('leaves out jobs already in the pipeline and jobs the user unticks', async () => {
    const { el, importRoles, open, click, fixture, settle } = await setup([
      // the same job, added earlier from a different form of its link
      {
        url: 'https://bd.linkedin.com/jobs/view/senior-angular-engineer-at-acme-4012345678?trk=x',
        company: 'Acme Corp',
        title: 'Sr Angular Engineer',
      },
      // the same job, found on the company's own site
      {
        url: 'https://initech.example/careers/7',
        company: 'Initech',
        title: 'Frontend Engineer',
      },
    ]);
    await open(
      zip({ 'Saved Jobs.csv': SAVED, 'Connections.csv': CONNECTIONS }),
    );
    expect(el.querySelector('#li-preview')?.textContent).toContain(
      '1 job to add',
    );
    expect(el.querySelector('#li-preview')?.textContent).toContain(
      '2 already in your jobs',
    );
    // untick the one job and the connections: nothing is left to import
    fixture.componentInstance.tick(
      'https://www.linkedin.com/jobs/view/4044444444/',
      false,
    );
    fixture.componentInstance.keep.set(false);
    await settle();
    expect((el.querySelector('#li-run') as HTMLButtonElement).disabled).toBe(
      true,
    );
    fixture.componentInstance.keep.set(true);
    await settle();
    await click('#li-run');
    expect(importRoles).not.toHaveBeenCalled();
  });

  it('says so when the pick holds nothing it reads', async () => {
    const { el, open } = await setup();
    await open([
      { name: 'holiday.jpg', size: 1, read: async () => new Uint8Array([1]) },
    ]);
    expect(el.querySelector('#li-problem')?.textContent).toContain(
      'None of those files',
    );
    expect(el.querySelector('#li-preview')).toBeNull();
  });

  it('deletes the kept connections after asking', async () => {
    const { el, linkedin, open, click, fixture, settle } = await setup();
    await open(zip({ 'Connections.csv': CONNECTIONS }));
    await click('#li-run');
    expect(linkedin.total()).toBe(2);
    const confirm = TestBed.inject(Confirm);
    const asked = fixture.componentInstance.deleteConnections();
    expect(confirm.pending()?.title).toContain(
      'Delete your LinkedIn connections',
    );
    confirm.settle(true);
    await asked;
    await settle();
    expect(linkedin.total()).toBe(0);
    expect(el.querySelector('#li-kept')).toBeNull();
  });
});
