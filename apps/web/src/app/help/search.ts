import { HELP_ARTICLES, type HelpArticle } from './articles';

/**
 * Finds help articles for a question typed in everyday words. No AI and no
 * server: the articles ship with the app, so this works for everyone, at
 * once, and for free.
 *
 * Each word of the question is compared with the article's title, its other
 * words, its summary and its steps, in that order of weight. Words are cut
 * to a rough stem ("jobs", "jobbing" → "job") and a few everyday or old
 * names are mapped to the app's own words ("cv" → "resume").
 */

export interface HelpHit {
  article: HelpArticle;
  score: number;
}

/** Words that say nothing about the question. */
const STOP = new Set(
  (
    'a an and are as at be but by can could do does did for from get got have ' +
    'how i if in into is it its me my of on or please should so that the then ' +
    'there this to was what when where which who why will with would you your ' +
    'yours am im ive dont cant doesnt isnt not no any some just want need help ' +
    'jobbotix app use using way there here able tell show about also'
  ).split(' '),
);

/** Everyday or older words mapped to the words the app uses. */
const SYNONYMS: Record<string, string> = {
  cv: 'resume',
  curriculum: 'resume',
  role: 'job',
  posting: 'job',
  listing: 'job',
  vacancy: 'job',
  opening: 'job',
  position: 'job',
  board: 'applications',
  kanban: 'applications',
  pipeline: 'applications',
  tracker: 'applications',
  digest: 'email',
  newsletter: 'email',
  notification: 'email',
  salary: 'pay',
  wage: 'pay',
  money: 'pay',
  wfh: 'remote',
  login: 'sign',
  logon: 'sign',
  signin: 'sign',
  log: 'sign',
  passcode: 'password',
  key: 'key',
  token: 'key',
  gpt: 'ai',
  chatgpt: 'ai',
  llm: 'ai',
  insight: 'progress',
  stats: 'progress',
  source: 'site',
  remove: 'delete',
  erase: 'delete',
  people: 'contact',
  recruiter: 'contact',
  subscription: 'plan',
  pricing: 'price',
  billing: 'payment',
  designation: 'title',
};

/** Lower case, letters and digits only, cut to a rough stem, mapped. */
export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => {
      const m = SYNONYMS[w] ?? w;
      return SYNONYMS[stem(m)] ?? stem(m);
    });
}

function stem(w: string): string {
  if (w.length <= 3) return w;
  for (const end of ['ing', 'ies', 'ed', 'es', 's']) {
    if (w.endsWith(end) && w.length - end.length >= 3) {
      return end === 'ies' ? w.slice(0, -3) + 'y' : w.slice(0, -end.length);
    }
  }
  return w;
}

interface Indexed {
  article: HelpArticle;
  title: Set<string>;
  words: Set<string>;
  summary: Set<string>;
  body: Set<string>;
  /** Whole phrases from `words`, for an exact match of several words. */
  phrases: string[];
}

let index: Indexed[] | null = null;

function indexed(): Indexed[] {
  index ??= HELP_ARTICLES.map((article) => ({
    article,
    title: new Set(terms(article.title)),
    words: new Set((article.words ?? []).flatMap(terms)),
    summary: new Set(terms(article.summary)),
    body: new Set(
      [...(article.steps ?? []), ...(article.notes ?? [])].flatMap(terms),
    ),
    phrases: (article.words ?? [])
      .filter((w) => w.includes(' '))
      .map((w) => w.toLowerCase()),
  }));
  return index;
}

/** Below this an article is not worth offering as an answer. */
export const MIN_SCORE = 3;

/**
 * The articles that best answer `question`, best first. `page` (the address
 * the person is on) gives a small lift to articles about that page.
 */
export function searchHelp(question: string, page = '', limit = 3): HelpHit[] {
  const q = terms(question);
  if (!q.length) return [];
  const lower = question.toLowerCase();
  const hits: HelpHit[] = [];
  for (const it of indexed()) {
    let score = 0;
    let matched = 0;
    for (const t of q) {
      const s =
        (it.title.has(t) ? 4 : 0) +
        (it.words.has(t) ? 3 : 0) +
        (it.summary.has(t) ? 1.5 : 0) +
        (it.body.has(t) ? 0.75 : 0);
      if (s > 0) matched++;
      score += s;
    }
    // A long question that shares one word with an article is about something else.
    if (matched < Math.ceil(q.length / 3)) continue;
    for (const p of it.phrases) if (lower.includes(p)) score += 3;
    // Questions where most words match beat ones that match a single word.
    score *= 0.5 + (0.5 * matched) / q.length;
    if (page && onPage(it.article, page)) score += 1;
    hits.push({ article: it.article, score });
  }
  return hits
    .filter((h) => h.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function onPage(a: HelpArticle, page: string): boolean {
  return (a.pages ?? []).some((p) =>
    p.endsWith('/')
      ? page.startsWith(p)
      : page === p || page.startsWith(p + '/'),
  );
}

/** Questions to offer before anything is typed, for the page the person is on. */
export function suggestionsFor(page: string, limit = 3): HelpArticle[] {
  // Articles whose main page this is come first, then those that mention it.
  const main = (a: HelpArticle) => {
    const p = a.pages?.[0];
    return !!p && onPage({ ...a, pages: [p] }, page);
  };
  const here = HELP_ARTICLES.filter((a) => onPage(a, page)).sort(
    (a, b) => Number(main(b)) - Number(main(a)),
  );
  const general = ['get-started', 'match-score', 'no-jobs'].map(
    (id) => HELP_ARTICLES.find((a) => a.id === id) as HelpArticle,
  );
  const out: HelpArticle[] = [];
  for (const a of [...here, ...general]) {
    if (out.length >= limit) break;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}
