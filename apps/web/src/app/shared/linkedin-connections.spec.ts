import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ContactRow } from '@jobbotix/shared-types';
import { MemoryLinkedInRepo } from '../core/data/linkedin-repos';
import { LinkedInRepo, PeopleRepo } from '../core/data/repos';
import { LinkedInConnections } from './linkedin-connections';

const LIST = [
  {
    name: 'Dana Whitfield',
    company: 'Acme',
    title: 'Engineering Manager',
    profile_url: 'https://www.linkedin.com/in/dana-whitfield-example',
    connected_on: '2025-11-17',
  },
  {
    name: 'Ravi Menon',
    company: 'Globex',
    title: 'Senior Recruiter',
    profile_url: '',
    connected_on: null,
  },
];

async function setup(kept = LIST, contacts: Partial<ContactRow>[] = []) {
  const all = signal(contacts as ContactRow[]);
  const save = vi.fn().mockImplementation(async (_id, input) => {
    all.update((l) => [...l, { linkedin_url: '', ...input } as ContactRow]);
    return input;
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: LinkedInRepo, useClass: MemoryLinkedInRepo },
      { provide: PeopleRepo, useValue: { contacts: all, save } },
    ],
  });
  await TestBed.inject(LinkedInRepo).replaceConnections(kept);
  const fixture = TestBed.createComponent(LinkedInConnections);
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await settle();
  await fixture.componentInstance.ready;
  await settle();
  const el: HTMLElement = fixture.nativeElement;
  const names = () =>
    [...el.querySelectorAll('#li-conn-list li p.font-medium')].map((p) =>
      p.textContent?.trim(),
    );
  return { fixture, el, save, settle, names };
}

describe('LinkedInConnections', () => {
  it('shows nothing when no LinkedIn file was imported', async () => {
    const { el } = await setup([]);
    expect(el.textContent?.trim()).toBe('');
  });

  it('lists the kept connections and searches them', async () => {
    const { fixture, el, settle, names } = await setup();
    expect(el.querySelector('#li-conn-h')?.textContent).toContain('(2)');
    expect(names()).toEqual(['Dana Whitfield', 'Ravi Menon']);
    await fixture.componentInstance.run('globex');
    await settle();
    expect(names()).toEqual(['Ravi Menon']);
    await fixture.componentInstance.run('nobody');
    await settle();
    expect(el.querySelector('#li-conn-list')?.textContent).toContain(
      'Nobody matches',
    );
  });

  it('copies one person into contacts only when asked', async () => {
    const { el, save, settle } = await setup();
    expect(save).not.toHaveBeenCalled();
    (el.querySelector('#li-conn-list button') as HTMLButtonElement).click();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]).toEqual([
      null,
      {
        name: 'Dana Whitfield',
        company: 'Acme',
        title: 'Engineering Manager',
        relation: 'peer',
        linkedin_url: 'https://www.linkedin.com/in/dana-whitfield-example',
        notes: 'Connected on LinkedIn since 2025-11-17.',
      },
    ]);
    // and is then marked, not offered again
    expect(el.querySelector('#li-conn-list li')?.textContent).toContain(
      'In contacts',
    );
  });

  it('knows who is a contact already', async () => {
    const { el } = await setup(LIST, [
      { name: 'ravi menon', company: 'GLOBEX', linkedin_url: '' },
    ]);
    const rows = [...el.querySelectorAll('#li-conn-list li')];
    expect(rows[0].textContent).toContain('Add to contacts');
    expect(rows[1].textContent).toContain('In contacts');
  });
});
