import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type {
  ContactRow,
  RoleContactRow,
  RoleRow,
} from '@jobbotix/shared-types';
import { MemoryLinkedInRepo } from '../../core/data/linkedin-repos';
import { LinkedInRepo, PeopleRepo } from '../../core/data/repos';
import { RoleConnections } from './role-connections';

const LIST = [
  {
    name: 'Dana Whitfield',
    company: 'ACME, Inc.',
    title: 'Engineering Manager',
    profile_url: 'https://www.linkedin.com/in/dana-whitfield-example',
    connected_on: '2025-11-17',
  },
  {
    name: 'Lena Ortiz',
    company: 'The Acme Company',
    title: 'Staff Engineer',
    profile_url: '',
    connected_on: null,
  },
  {
    name: 'Ravi Menon',
    company: 'Globex',
    title: 'Senior Recruiter',
    profile_url: '',
    connected_on: null,
  },
];

async function setup(
  company: string,
  kept = LIST,
  contacts: Partial<ContactRow>[] = [],
) {
  const all = signal(contacts as ContactRow[]);
  const links = signal<RoleContactRow[]>([]);
  const save = vi.fn().mockImplementation(async (_id, input) => {
    const row = { id: 'c-new', linkedin_url: '', ...input } as ContactRow;
    all.update((l) => [...l, row]);
    return row;
  });
  const link = vi.fn().mockImplementation(async (role_id, contact_id) => {
    links.update((l) => [...l, { role_id, contact_id } as RoleContactRow]);
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LinkedInRepo, useClass: MemoryLinkedInRepo },
      {
        provide: PeopleRepo,
        useValue: {
          contacts: all,
          links,
          loaded: signal(true),
          load: async () => undefined,
          save,
          link,
        },
      },
    ],
  });
  await TestBed.inject(LinkedInRepo).replaceConnections(kept);
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  const fixture = TestBed.createComponent(RoleConnections);
  fixture.componentRef.setInput('role', {
    id: 'r1',
    company,
    title: 'Senior Angular Engineer',
  } as RoleRow);
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.componentInstance.ready;
    fixture.detectChanges();
  };
  await settle();
  const el: HTMLElement = fixture.nativeElement;
  return { fixture, el, save, link, navigate, settle };
}

describe('RoleConnections', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows who the user knows at the company, however it is written', async () => {
    const { el } = await setup('Acme');
    expect(el.querySelector('#role-li-known')?.textContent).toContain(
      'You know 2 people at Acme',
    );
    expect(el.textContent).toContain('Dana Whitfield');
    expect(el.textContent).toContain('Lena Ortiz');
    expect(el.textContent).not.toContain('Ravi Menon');
  });

  it('always offers LinkedIn’s own people search as a plain link', async () => {
    const { el } = await setup('Initech');
    expect(el.querySelector('#role-li-known')).toBeNull();
    const a = el.querySelector('#role-li-search') as HTMLAnchorElement;
    expect(a.href).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=Initech',
    );
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener');
  });

  it('points to the import when no LinkedIn file was imported', async () => {
    const { el } = await setup('Acme', []);
    expect(el.querySelector('#role-li-hint')?.textContent).toContain(
      'Import your LinkedIn file',
    );
  });

  it('shows nothing for a job that does not name its company', async () => {
    const { el } = await setup('Unknown company');
    expect(el.textContent?.trim()).toBe('');
  });

  it('makes the person a contact on this job, then opens the draft', async () => {
    const { el, save, link, navigate, settle } = await setup('Acme');
    (el.querySelector('ul button') as HTMLButtonElement).click();
    await settle();
    expect(save).toHaveBeenCalledWith(null, {
      name: 'Dana Whitfield',
      company: 'ACME, Inc.',
      title: 'Engineering Manager',
      relation: 'referrer',
      linkedin_url: 'https://www.linkedin.com/in/dana-whitfield-example',
      notes: 'Connected on LinkedIn since 2025-11-17.',
    });
    expect(link).toHaveBeenCalledWith('r1', 'c-new');
    expect(navigate).toHaveBeenCalledWith(['/people', 'c-new'], {
      queryParams: { draft: 1 },
    });
  });

  it('uses the contact that already exists instead of adding a second', async () => {
    const { el, save, link, navigate, settle } = await setup('Acme', LIST, [
      {
        id: 'c-dana',
        name: 'Dana Whitfield',
        company: 'Acme',
        linkedin_url: 'https://www.linkedin.com/in/dana-whitfield-example/',
      },
    ]);
    (el.querySelector('ul button') as HTMLButtonElement).click();
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(link).toHaveBeenCalledWith('r1', 'c-dana');
    expect(navigate).toHaveBeenCalledWith(['/people', 'c-dana'], {
      queryParams: { draft: 1 },
    });
  });
});
