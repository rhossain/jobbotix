import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { RoleRow } from '@jobbotix/shared-types';
import { MemoryLinkedInRepo } from '../../core/data/linkedin-repos';
import { LinkedInRepo } from '../../core/data/repos';
import { KnownNudge } from './known-nudge';

const person = (name: string, company: string) => ({
  name,
  company,
  title: 'Engineer',
  profile_url: '',
  connected_on: null,
});
const role = (id: string, company: string, extra: Partial<RoleRow> = {}) =>
  ({ id, company, title: `Engineer ${id}`, ...extra }) as RoleRow;

async function setup(
  roles: RoleRow[],
  kept = [
    person('Dana', 'ACME, Inc.'),
    person('Lena', 'Acme'),
    person('Ravi', 'Globex'),
  ],
) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LinkedInRepo, useClass: MemoryLinkedInRepo },
    ],
  });
  const repo = TestBed.inject(LinkedInRepo);
  await repo.replaceConnections(kept);
  const asked = vi.spyOn(repo, 'atCompanies');
  const fixture = TestBed.createComponent(KnownNudge);
  const show = async (list: RoleRow[]) => {
    fixture.componentRef.setInput('roles', list);
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.componentInstance.ready;
    fixture.detectChanges();
  };
  await show(roles);
  const el: HTMLElement = fixture.nativeElement;
  return { el, asked, show };
}

describe('KnownNudge', () => {
  afterEach(() => vi.restoreAllMocks());

  it('names the new jobs at companies where the user knows someone', async () => {
    const { el, asked } = await setup([
      role('a', 'Acme Inc'),
      role('b', 'Initech'),
      role('c', 'Globex GmbH'),
    ]);
    const text = el.querySelector('#known-nudge')?.textContent ?? '';
    expect(text).toContain('You know someone at these companies');
    expect(text).toContain('Engineer a at Acme Inc');
    expect(text).toContain('2 connections');
    expect(text).toContain('Engineer c at Globex GmbH');
    expect(text).toContain('1 connection');
    expect(text).not.toContain('Initech');
    // one request for all the new jobs
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('stays silent when nobody is known, and when nothing was imported', async () => {
    expect(
      (await setup([role('b', 'Initech')])).el.querySelector('#known-nudge'),
    ).toBeNull();
    TestBed.resetTestingModule();
    const none = await setup([role('a', 'Acme')], []);
    expect(none.el.querySelector('#known-nudge')).toBeNull();
    expect(none.asked).not.toHaveBeenCalled();
  });

  it('does not ask again when only the jobs change, not the companies', async () => {
    const { el, asked, show } = await setup([
      role('a', 'Acme'),
      role('a2', 'Acme'),
    ]);
    expect(asked).toHaveBeenCalledTimes(1);
    // one of them was sorted away: same company, no new request
    await show([role('a2', 'Acme')]);
    expect(asked).toHaveBeenCalledTimes(1);
    const text = el.querySelector('#known-nudge')?.textContent ?? '';
    expect(text).toContain('Engineer a2 at Acme');
    expect(text).not.toContain('Engineer a at Acme');
  });

  it('leaves Upwork gigs and unnamed companies out', async () => {
    const { el } = await setup(
      [
        role('g', 'Upwork client', { entry_kind: 'gig' }),
        role('u', 'Unknown company'),
      ],
      [person('Dana', 'Upwork client'), person('Lena', 'Unknown')],
    );
    expect(el.querySelector('#known-nudge')).toBeNull();
  });
});
