// Turning a job posting into role fields. The same module runs in the
// extract-role Edge Function (supabase/functions/_shared/extract.ts is a copy;
// keep both in step) and in the app for demo mode.

export interface ExtractedRole {
  company: string;
  title: string;
  location: string;
  type: 'full_time' | 'contract' | 'freelance' | 'part_time';
  salary: string;
  stack: string[];
  postingText: string;
}

/** Strip a job page down to readable text: no scripts, styles, nav or markup. */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(
    /<(nav|footer|header|aside|noscript|svg|iframe)[\s\S]*?<\/\1>/gi,
    ' ',
  );
  s = s.replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  s = s
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** The <title> of the page, used as a fallback title when no AI key is set. */
export function pageTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? htmlToText(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

/** Best-effort fields without AI: title from <title>, company guessed from "Title at Company" / "Title - Company". */
export function heuristicExtract(url: string, html: string): ExtractedRole {
  const text = htmlToText(html).slice(0, 50_000);
  // No <title> (pasted text): the first short line is almost always the title.
  const firstLine =
    text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length >= 4 && l.length <= 120) ?? '';
  const t = pageTitle(html) || firstLine;
  let title = t;
  let company = '';
  const m = t.match(/^(.+?)\s+(?:at|@|-|–|—|\|)\s+(.+?)(?:\s*[-–—|]\s*.+)?$/);
  if (m) {
    title = m[1].trim();
    company = m[2].trim();
  }
  if (!company) {
    try {
      company = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
      company = company.charAt(0).toUpperCase() + company.slice(1);
    } catch {
      company = '';
    }
  }
  const lower = text.toLowerCase();
  const fullTime = /\bfull[- ]time\b/.test(lower);
  const type: ExtractedRole['type'] = fullTime
    ? 'full_time'
    : /\bfreelanc(?:e|er|ing)\b/.test(lower)
      ? 'freelance'
      : /\b(?:contract|contractor)\b/.test(lower)
        ? 'contract'
        : /\bpart[- ]time\b/.test(lower)
          ? 'part_time'
          : 'full_time';
  const salaryMatch = text.match(
    /(?:[$€£]\s?\d[\d,.]*\s?[kK]?(?:\s?[-–]\s?[$€£]?\s?\d[\d,.]*\s?[kK]?)?(?:\s?(?:per|\/)\s?(?:year|yr|hour|hr|h))?)/,
  );
  const location = /\bremote\b/i.test(text) ? 'Remote' : '';
  return {
    company,
    title: title || 'Untitled role',
    location,
    type,
    salary: salaryMatch ? salaryMatch[0].trim() : '',
    stack: detectStack(text),
    postingText: text,
  };
}

const KNOWN_STACK = [
  'Angular',
  'React',
  'Vue',
  'Svelte',
  'Next.js',
  'Nuxt',
  'TypeScript',
  'JavaScript',
  'RxJS',
  'NgRx',
  'Signals',
  'Tailwind',
  'SCSS',
  'Sass',
  'CSS',
  'HTML',
  'Angular Material',
  'Bootstrap',
  'Storybook',
  'Jest',
  'Vitest',
  'Cypress',
  'Playwright',
  'Node.js',
  'NestJS',
  'Express',
  'GraphQL',
  'REST',
  'PostgreSQL',
  'Supabase',
  'Firebase',
  'AWS',
  'Docker',
  'Kubernetes',
  'Figma',
  'WordPress',
  'NopCommerce',
  'Cursor',
  'Claude Code',
  'Copilot',
  'Anthropic API',
  'OpenAI',
];

export function detectStack(text: string): string[] {
  const found: string[] = [];
  for (const k of KNOWN_STACK) {
    const re = new RegExp(
      `(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`,
      'i',
    );
    if (re.test(text)) found.push(k);
  }
  return found;
}

/** The prompt sent to the user's own Anthropic key for a proper extraction. */
export function extractionPrompt(url: string, text: string): string {
  return `Extract the job posting below into JSON with exactly these keys:
{"company": string, "title": string, "location": string (remote scope in a few words, e.g. "Remote, worldwide" or "Remote, EU only" or "Hybrid, Berlin"), "type": "full_time" | "contract" | "freelance" | "part_time", "salary": string ("" if not stated), "stack": string[] (technologies and tools named, max 20), "posted": string (ISO date or ""), "summary": string (two sentences on what the role is)}
Return only the JSON object, no prose.

URL: ${url}

POSTING:
${text.slice(0, 30_000)}`;
}

/** Parses the model's JSON reply defensively. */
export function parseExtraction(
  reply: string,
): (Partial<ExtractedRole> & { posted?: string; summary?: string }) | null {
  const m = reply.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return {
      company: str(o['company']),
      title: str(o['title']),
      location: str(o['location']),
      type:
        (['contract', 'freelance', 'part_time'] as const).find(
          (t) => t === str(o['type']),
        ) ?? 'full_time',
      salary: str(o['salary']),
      stack: Array.isArray(o['stack'])
        ? (o['stack'] as unknown[])
            .filter((x): x is string => typeof x === 'string')
            .slice(0, 20)
        : [],
      posted: str(o['posted']),
      summary: str(o['summary']),
    };
  } catch {
    return null;
  }
}
