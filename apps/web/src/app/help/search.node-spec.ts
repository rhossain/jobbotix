import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HELP_AREAS, HELP_ARTICLES } from './articles';
import { searchHelp, suggestionsFor, terms } from './search';

const routes = readFileSync(
  new URL('../app.routes.ts', import.meta.url),
  'utf8',
);

/** True when some route in app.routes.ts serves this address. */
function routed(link: string): boolean {
  const path = link.split(/[?#]/)[0].replace(/^\//, '');
  if (routes.includes(`path: '${path}'`)) return true;
  // Tabbed pages: /settings/ai is served by withTab('settings', [..'ai'..]).
  const [base, tab] = path.split('/');
  const m = routes.match(new RegExp(`withTab\\('${base}', \\[([^\\]]*)\\]`));
  return !!m && (!tab || m[1].includes(`'${tab}'`));
}

describe('help articles', () => {
  it('has unique ids that work as addresses', () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('puts every article in a known area, with a question and an answer', () => {
    const areas = new Set(HELP_AREAS.map((a) => a.id));
    for (const a of HELP_ARTICLES) {
      expect(areas.has(a.area), a.id).toBe(true);
      expect(a.title.endsWith('?'), a.id).toBe(true);
      expect(a.summary.length, a.id).toBeGreaterThan(20);
    }
  });

  it('links only to pages that exist', () => {
    for (const a of HELP_ARTICLES)
      if (a.link)
        expect(routed(a.link.to), `${a.id} → ${a.link.to}`).toBe(true);
  });

  it('keeps each article short enough to read in the chat', () => {
    for (const a of HELP_ARTICLES) {
      const words = [a.summary, ...(a.steps ?? []), ...(a.notes ?? [])]
        .join(' ')
        .split(/\s+/).length;
      expect(words, a.id).toBeLessThan(220);
      expect((a.steps ?? []).length, a.id).toBeLessThanOrEqual(7);
    }
  });
});

describe('searchHelp', () => {
  const top = (q: string, page = '') => searchHelp(q, page)[0]?.article.id;

  it.each([
    ['How do I upload my CV?', 'add-resume'],
    ['what is the match score', 'match-score'],
    ['why am I getting no jobs', 'no-jobs'],
    ['how to get a free gemini key', 'connect-gemini'],
    ['add a job from linkedin', 'add-job-linkedin'],
    ['stop the daily digest emails', 'daily-email'],
    ['I forgot my password', 'reset-password'],
    ['delete my account', 'delete-account'],
    ['does it apply for me automatically', 'never-applies'],
    ['what does Pro cost', 'free-and-pro'],
    ['how do I switch to dark mode', 'dark-mode'],
    ['download resume as pdf', 'download-resume'],
    ['rate limit reached on gemini', 'ai-limit'],
    ['talk to a person', 'contact-support'],
  ])('answers "%s" with %s', (q, id) => {
    expect(top(q)).toBe(id);
  });

  it('finds nothing for a question it has no article for', () => {
    expect(searchHelp('write me a poem about the sea')).toEqual([]);
    expect(searchHelp('   ')).toEqual([]);
  });

  it('prefers the article about the page the person is on', () => {
    const onJob = searchHelp('how do I add it', '/jobs/abc');
    expect(onJob.length).toBeGreaterThan(0);
  });

  it('maps everyday and old words to the app’s own', () => {
    expect(terms('my CV')).toEqual(['resume']);
    expect(terms('the board')).toEqual(terms('applications'));
    expect(terms('Salaries')).toEqual(['pay']);
  });
});

describe('suggestionsFor', () => {
  it('offers three questions on every page, the page’s own first', () => {
    expect(suggestionsFor('/resume').map((a) => a.id)[0]).toBe('add-resume');
    for (const page of ['/today', '/jobs', '/board', '/settings', '/nowhere'])
      expect(suggestionsFor(page)).toHaveLength(3);
  });
});

describe('the Edge Functions copy', () => {
  it('matches the articles and search (run node tools/sync-help.mjs)', async () => {
    // @ts-expect-error: a plain .mjs script without types
    const { buildCopy, COPY } = await import('../../../../../tools/sync-help.mjs');
    expect(readFileSync(COPY, 'utf8')).toBe(buildCopy());
  });
});
