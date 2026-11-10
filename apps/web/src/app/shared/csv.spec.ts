import { describe, expect, it } from 'vitest';
import type { RoleRow } from '@jobbotix/shared-types';
import { mapStatus, parseCsv, previewImport, rolesToCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads quotes, escaped quotes, newlines in cells and CRLF', () => {
    expect(
      parseCsv('a,b\r\n"x, y","he said ""hi"""\n"multi\nline",z\n\n'),
    ).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', 'z'],
    ]);
  });

  it('detects semicolons and tabs, and drops a BOM', () => {
    expect(parseCsv('﻿a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a\tb\n1,5\t2')).toEqual([
      ['a', 'b'],
      ['1,5', '2'],
    ]);
  });
});

describe('toCsv', () => {
  it('quotes when needed and neutralises formulas', () => {
    expect(toCsv([['a,b', '=SUM(A1)', 'plain', null]])).toBe(
      '"a,b",\'=SUM(A1),plain,\r\n',
    );
  });

  it('round-trips roles', () => {
    const csv = rolesToCsv([
      {
        company: 'Acme, Inc.',
        title: 'Dev',
        url: 'https://a.example/1',
        status: 'applied',
        score: 80,
        notes: 'line 1\nline 2',
      } as RoleRow,
    ]);
    const rows = parseCsv(csv);
    expect(rows[0][0]).toBe('company');
    expect(rows[1].slice(0, 5)).toEqual([
      'Acme, Inc.',
      'Dev',
      'https://a.example/1',
      'applied',
      '80',
    ]);
    expect(rows[1][12]).toBe('line 1\nline 2');
  });
});

describe('mapStatus', () => {
  it.each([
    ['Wishlist', 'shortlist'],
    ['Bookmarked', 'shortlist'],
    ['Applied', 'applied'],
    ['Interviewing', 'interview'],
    ['Phone screen', 'interview'],
    ['Offer', 'offer'],
    ['Rejected', 'rejected'],
    ['Archived', 'skipped'],
    ['', 'new'],
    ['Something else', 'new'],
  ])('%s → %s', (input, want) => {
    expect(mapStatus(input)).toBe(want);
  });
});

describe('previewImport', () => {
  it('maps a Huntr-style export and skips what it cannot use', () => {
    const p = previewImport(
      [
        'Job Title,Company Name,Job URL,List,Location,Notes',
        'Senior Angular Engineer,Acme,https://acme.example/jobs/1,Applied,Remote,Sent via form',
        'Frontend Lead,Beta,beta.example/careers/2,Wishlist,,',
        'No link,Gamma,,Applied,,',
        ',Delta,https://d.example/1,,,',
        'Dup,Acme,https://acme.example/jobs/1,,,',
      ].join('\n'),
    );
    expect(p.columns).toMatchObject({
      title: 'Job Title',
      company: 'Company Name',
      url: 'Job URL',
      status: 'List',
    });
    expect(p.roles).toEqual([
      {
        company: 'Acme',
        title: 'Senior Angular Engineer',
        url: 'https://acme.example/jobs/1',
        status: 'applied',
        location: 'Remote',
        salary: '',
        notes: 'Sent via form',
      },
      expect.objectContaining({
        url: 'https://beta.example/careers/2',
        status: 'shortlist',
      }),
    ]);
    expect(p.skipped.map((s) => [s.row, s.reason])).toEqual([
      [4, 'No link to the posting'],
      [5, 'No company or title'],
      [6, 'Same link as an earlier row'],
    ]);
  });

  it('handles an empty file', () => {
    expect(previewImport('')).toEqual({ roles: [], skipped: [], columns: {} });
  });
});
