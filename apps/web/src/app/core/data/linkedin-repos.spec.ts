import { describe, expect, it } from 'vitest';
import { MemoryLinkedInRepo, searchWords } from './linkedin-repos';

describe('searchWords', () => {
  it('drops what would change the meaning of a filter', () => {
    expect(searchWords('  Acme, Inc. (EU) 100%  ')).toBe('Acme Inc EU 100');
    expect(searchWords('name.ilike.*')).toBe('name ilike');
    expect(searchWords('"; drop')).toBe('; drop');
    expect(searchWords('')).toBe('');
    expect(searchWords('x'.repeat(200)).length).toBe(80);
  });
});

describe('MemoryLinkedInRepo', () => {
  const list = [
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

  it('puts a new list in place of the old one and searches it', async () => {
    const repo = new MemoryLinkedInRepo();
    expect(await repo.replaceConnections(list)).toEqual({
      saved: 2,
      failed: 0,
    });
    expect(repo.total()).toBe(2);
    expect((await repo.search('acme')).map((c) => c.name)).toEqual([
      'Dana Whitfield',
    ]);
    expect((await repo.search('recruit')).map((c) => c.name)).toEqual([
      'Ravi Menon',
    ]);
    expect((await repo.search('')).length).toBe(2);
    await repo.replaceConnections(list.slice(1));
    expect(repo.total()).toBe(1);
    expect(await repo.search('dana')).toEqual([]);
  });

  it('forgets everything when asked', async () => {
    const repo = new MemoryLinkedInRepo();
    await repo.replaceConnections(list);
    await repo.deleteConnections();
    expect(repo.total()).toBe(0);
    expect(await repo.search('')).toEqual([]);
  });
});
