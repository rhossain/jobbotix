import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetweenDays,
  dueContacts,
  isoDay,
  localMessage,
  messagePrompt,
  parseMessageReply,
  suggestedMessage,
  type MessageContext,
} from './contacts';

describe('dates', () => {
  it('adds days across months', () => {
    expect(addDays('2026-11-28', 7)).toBe('2026-12-05');
    expect(addDays('2026-11-10', -10)).toBe('2026-10-31');
  });
  it('reads a day in a time zone', () => {
    // 20:00 UTC on the 10th is the 11th in Dhaka
    expect(isoDay(new Date('2026-11-10T20:00:00Z'), 'Asia/Dhaka')).toBe(
      '2026-11-11',
    );
  });
  it('counts days between dates', () => {
    expect(daysBetweenDays('2026-11-08', '2026-11-10')).toBe(2);
    expect(daysBetweenDays('2026-11-10', '2026-11-08')).toBe(-2);
  });
});

describe('dueContacts', () => {
  it('lists people due today or earlier, most overdue first', () => {
    const list = [
      { name: 'B', next_touch_on: '2026-11-10' },
      { name: 'A', next_touch_on: '2026-11-10' },
      { name: 'Late', next_touch_on: '2026-11-02' },
      { name: 'Later', next_touch_on: '2026-11-11' },
      { name: 'None', next_touch_on: null },
    ];
    expect(dueContacts(list, '2026-11-10').map((c) => c.name)).toEqual([
      'Late',
      'A',
      'B',
    ]);
  });
});

describe('suggestedMessage', () => {
  it('fits the relation and the history', () => {
    expect(suggestedMessage('recruiter', null)).toBe('recruiter_reply');
    expect(suggestedMessage('referrer', null)).toBe('referral');
    expect(suggestedMessage('hiring_manager', null)).toBe('outreach');
    expect(suggestedMessage('recruiter', 'in')).toBe('recruiter_reply');
    expect(suggestedMessage('referrer', 'in')).toBe('check_in');
    expect(suggestedMessage('recruiter', 'out')).toBe('check_in');
  });
});

describe('messages', () => {
  const ctx: MessageContext = {
    kind: 'referral',
    candidate: 'Sazzad Hossain',
    headline: 'Senior Frontend Engineer with 15 years in Angular',
    contact: {
      name: 'Ana Ruiz',
      title: 'Engineering Manager',
      company: 'Acme',
      relation: 'referrer',
      notes: 'Met at NgConf 2025',
    },
    role: {
      title: 'Senior Angular Engineer',
      company: 'Acme',
      url: 'https://acme.example/jobs/1',
    },
  };

  it('drafts each kind locally, addressed and signed', () => {
    for (const kind of [
      'outreach',
      'referral',
      'recruiter_reply',
      'check_in',
    ] as const) {
      const t = localMessage({ ...ctx, kind });
      expect(t.startsWith('Hi Ana,')).toBe(true);
      expect(t.endsWith('Sazzad Hossain')).toBe(true);
      expect(t.split(/\s+/).length).toBeLessThan(120);
    }
    expect(localMessage(ctx)).toContain(
      'Senior Angular Engineer role at Acme (https://acme.example/jobs/1)',
    );
    expect(localMessage({ ...ctx, kind: 'outreach' })).toContain(
      'the Engineering Manager at Acme',
    );
  });

  it('uses the first part of a headline, with the right article', () => {
    const t = localMessage({
      ...ctx,
      kind: 'outreach',
      headline: 'Angular developer | AI-Augmented Development',
    });
    expect(t).toContain("I'm an Angular developer and");
    expect(t).not.toContain('|');
    expect(t).toMatch(/Thanks,\nSazzad Hossain$/);
  });

  it('copes with no role and no name', () => {
    const t = localMessage({
      ...ctx,
      kind: 'outreach',
      role: null,
      contact: { ...ctx.contact, name: '', title: '' },
    });
    expect(t.startsWith('Hi,')).toBe(true);
    expect(t).toContain("I'm following Acme");
  });

  it('prompts with the facts and the incoming message', () => {
    const p = messagePrompt({
      ...ctx,
      kind: 'recruiter_reply',
      incoming: 'Hi Sazzad, are you open to a React role?',
    });
    expect(p).toContain('"Hi Ana,"');
    expect(p).toContain('Met at NgConf 2025');
    expect(p).toContain('are you open to a React role?');
    expect(p).not.toContain('What the candidate wants to say');
  });

  it('cleans a reply', () => {
    expect(
      parseMessageReply('```\nSubject: Hello\n\nHi Ana,\nThanks.\n```'),
    ).toBe('Hi Ana,\nThanks.');
  });
});
