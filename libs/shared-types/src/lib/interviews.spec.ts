import { describe, expect, it } from 'vitest';
import {
  calendarEvent,
  firstNames,
  formatInterviewTime,
  googleCalendarUrl,
  interviewLabel,
  localThankYou,
  needsDebrief,
  nextInterviewByRole,
  parseThankYouReply,
  thankYouPrompt,
  toIcs,
  upcomingInterviews,
  type InterviewLike,
} from './interviews';

const NOW = new Date('2026-11-10T06:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('missing');
  return v;
}

const iv = (p: Partial<InterviewLike>): InterviewLike => ({
  id: 'i1',
  role_id: 'r1',
  kind: 'technical',
  title: '',
  scheduled_at: at(24),
  duration_min: 60,
  location: 'https://meet.example/abc',
  interviewers: 'Ana Ruiz (EM), Ben Ode',
  status: 'scheduled',
  debrief: '',
  ...p,
});

describe('labels', () => {
  it('prefers the user label', () => {
    expect(interviewLabel(iv({}))).toBe('Technical interview');
    expect(interviewLabel(iv({ title: 'Pairing with the CTO' }))).toBe(
      'Pairing with the CTO',
    );
  });
});

describe('upcomingInterviews', () => {
  it('keeps scheduled rounds in the window, soonest first', () => {
    const list = [
      iv({ id: 'later', scheduled_at: at(72) }),
      iv({ id: 'soon', scheduled_at: at(2) }),
      iv({ id: 'just-started', scheduled_at: at(-0.5) }),
      iv({ id: 'past', scheduled_at: at(-3) }),
      iv({ id: 'far', scheduled_at: at(24 * 10) }),
      iv({ id: 'cancelled', scheduled_at: at(5), status: 'cancelled' }),
      iv({ id: 'undated', scheduled_at: null }),
    ];
    expect(upcomingInterviews(list, NOW).map((i) => i.id)).toEqual([
      'just-started',
      'soon',
      'later',
    ]);
  });

  it('gives the next round per role', () => {
    const m = nextInterviewByRole(
      [
        iv({ id: 'b', scheduled_at: at(48) }),
        iv({ id: 'a', scheduled_at: at(10) }),
        iv({ id: 'c', role_id: 'r2', scheduled_at: at(30) }),
      ],
      NOW,
    );
    expect(m.get('r1')?.id).toBe('a');
    expect(m.get('r2')?.id).toBe('c');
  });
});

describe('needsDebrief', () => {
  it('lists ended rounds from the last two weeks with no notes', () => {
    const list = [
      iv({ id: 'ended', scheduled_at: at(-3) }),
      iv({ id: 'running', scheduled_at: at(-0.5) }),
      iv({ id: 'noted', scheduled_at: at(-5), debrief: 'Asked about NgRx' }),
      iv({ id: 'old', scheduled_at: at(-24 * 20) }),
      iv({ id: 'cancelled', scheduled_at: at(-4), status: 'cancelled' }),
    ];
    expect(needsDebrief(list, NOW).map((i) => i.id)).toEqual(['ended']);
  });
});

describe('calendar', () => {
  const e = calendarEvent(
    iv({ location: 'Zoom; link in email, see notes' }),
    { company: 'Acme, Inc.', title: 'Senior Angular Engineer' },
    'https://app.jobbotix.com',
  );

  it('builds an event from the round', () => {
    expect(e?.title).toBe('Technical interview: Acme, Inc.');
    expect(e?.description).toContain('With: Ana Ruiz (EM), Ben Ode');
    expect(e?.description).toContain('https://app.jobbotix.com/roles/r1');
    expect(calendarEvent(iv({ scheduled_at: null }), e as never)).toBeNull();
  });

  it('writes a valid .ics with escaping, CRLF and a reminder', () => {
    const ics = toIcs(must(e), NOW);
    expect(ics).toContain('DTSTART:20261111T060000Z');
    expect(ics).toContain('DTEND:20261111T070000Z');
    expect(ics).toContain('SUMMARY:Technical interview: Acme\\, Inc.');
    expect(ics).toContain('LOCATION:Zoom\\; link in email\\, see notes');
    expect(ics).toContain('TRIGGER:-PT30M');
    expect(
      ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75),
    ).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('adds a URL line for a meeting link', () => {
    const v = must(calendarEvent(iv({}), { company: 'Acme', title: 'Dev' }));
    expect(toIcs(v, NOW)).toContain('URL:https://meet.example/abc');
  });

  it('builds a Google Calendar link', () => {
    const url = new URL(googleCalendarUrl(must(e)));
    expect(url.searchParams.get('dates')).toBe(
      '20261111T060000Z/20261111T070000Z',
    );
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
  });

  it('formats in the user time zone', () => {
    expect(formatInterviewTime(at(24), 'Asia/Dhaka')).toBe('Wed 11 Nov, 12:00');
    expect(formatInterviewTime(at(24), 'Not/AZone')).toContain('UTC');
  });
});

describe('thank-you note', () => {
  const ctx = {
    candidate: 'Sazzad Hossain',
    company: 'Acme',
    roleTitle: 'Senior Angular Engineer',
    kind: 'technical' as const,
    interviewers: 'Ana Ruiz (EM), Ben Ode',
    debrief: 'Talked about their NgRx to signals migration.',
  };

  it('reads first names', () => {
    expect(firstNames('Ana Ruiz (EM), Ben Ode')).toEqual(['Ana', 'Ben']);
    expect(firstNames('Ana and Ben & Chris')).toEqual(['Ana', 'Ben', 'Chris']);
    expect(firstNames('')).toEqual([]);
  });

  it('drafts locally with one bracket to fill', () => {
    const t = localThankYou(ctx);
    expect(t.startsWith('Hi Ana and Ben,')).toBe(true);
    expect(t).toContain('Senior Angular Engineer role at Acme');
    expect(t.match(/\[/g)).toHaveLength(1);
    expect(t.endsWith('Sazzad Hossain')).toBe(true);
    expect(
      localThankYou({ ...ctx, interviewers: '', kind: 'take_home' }),
    ).toMatch(/^Hello,\n\nThank you for reviewing my take-home task/);
  });

  it('prompts with the notes and the greeting', () => {
    const p = thankYouPrompt(ctx);
    expect(p).toContain('"Hi Ana and Ben,"');
    expect(p).toContain('NgRx to signals');
  });

  it('cleans a reply', () => {
    expect(parseThankYouReply('Subject: Thanks\n\nHi Ana,\nThanks.')).toBe(
      'Hi Ana,\nThanks.',
    );
  });
});
