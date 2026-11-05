/**
 * Heuristic resume parser: plain text (pasted, or extracted from a .docx or
 * PDF) → ResumeSections. It is deliberately forgiving: anything it cannot
 * place lands in the nearest section rather than being dropped, and the
 * warnings tell the user what to check. The editor is the second pass.
 */
import {
  emptyResume,
  type EducationEntry,
  type ExperienceEntry,
  type ProjectEntry,
  type ResumeSections,
  type SkillGroup,
} from './resume';

export interface ResumeImport {
  resume: ResumeSections;
  warnings: string[];
}

type SectionKey =
  | 'summary'
  | 'skills'
  | 'experience'
  | 'projects'
  | 'aiToolkit'
  | 'education'
  | 'certifications'
  | 'other';

const HEADINGS: [SectionKey, RegExp][] = [
  [
    'aiToolkit',
    /^(ai|genai|ai[- ]assisted)\b.*(toolkit|tools?|tooling|stack|workflow)$/i,
  ],
  [
    'summary',
    /^(professional |career |executive )?(summary|profile|about( me)?|objective|overview|introduction)$/i,
  ],
  [
    'skills',
    /^(technical |core |key |relevant )?(skills|competencies|technologies|tech(nical)? ?stack|expertise|tools( & technologies)?)( (summary|& tools|and tools))?$/i,
  ],
  [
    'experience',
    /^((work|professional|employment|relevant) )?(experience|history)$|^career( history)?$|^employment$/i,
  ],
  [
    'projects',
    /^((selected|key|notable|personal|side|open[- ]source) )?projects?$|^portfolio$/i,
  ],
  [
    'education',
    /^(education|academics?|academic (background|qualifications?)|qualifications?)$/i,
  ],
  [
    'certifications',
    /^(certifications?|certificates|licen[sc]es?( (&|and) certifications?)?|awards( (&|and) certifications?)?|courses?)$/i,
  ],
  [
    'other',
    /^(languages?|interests|hobbies|references|volunteering|publications|activities)$/i,
  ],
];

const MONTHS =
  '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE = `(?:${MONTHS}\\s+\\d{4}|\\d{1,2}[/.]\\d{4}|\\d{4}(?:-\\d{2})?)`;
const RANGE = new RegExp(
  `\\(?(${DATE})\\s*(?:[-–—]|to|until)\\s*(${DATE}|present|current|now|today|ongoing)\\)?`,
  'i',
);
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const URL =
  /(?:https?:\/\/|www\.)[^\s|,;]+|(?:[\w-]+\.)+(?:com|io|dev|me|net|org|app|co)(?:\/[^\s|,;]*)?/i;
const BULLET = /^\s*(?:[-*•·▪◦‣●■□➢➤►✓✔]|\d+[.)])\s+/;
const TITLE_WORDS =
  /\b(engineer|developer|programmer|manager|lead|architect|designer|consultant|intern|analyst|director|head|specialist|founder|officer|cto|ceo|vp|president|administrator|scientist|researcher|coordinator|associate|assistant|teacher|instructor)\b/i;
const DEGREE =
  /\b(b\.?\s?sc|m\.?\s?sc|b\.?\s?a|m\.?\s?a|b\.?\s?eng|m\.?\s?eng|bachelor|master|mba|ph\.?d|doctor|diploma|associate|hsc|ssc|a-levels?|high school|bs|ms)\b/i;

export function parseResumeText(input: string): ResumeImport {
  const warnings: string[] = [];
  const resume = emptyResume();
  const lines = normaliseLines(input);
  if (lines.length === 0) return { resume, warnings: ['Nothing to import.'] };

  // Split into header + sections by heading lines.
  const sections = new Map<SectionKey, string[]>();
  const header: string[] = [];
  let current: SectionKey | null = null;
  for (const line of lines) {
    const key = headingKey(line);
    if (key) {
      current = key;
      if (!sections.has(key)) sections.set(key, []);
      continue;
    }
    if (current) sections.get(current)?.push(line);
    else header.push(line);
  }

  parseHeader(header, resume, warnings);
  const summary = sections.get('summary');
  if (summary) resume.summary = paragraph(summary);
  else if (header.length) {
    // A paragraph in the header is almost always the summary.
    const para = header.filter((l) => wordCount(l) > 12);
    if (para.length) resume.summary = paragraph(para);
  }

  const skills = sections.get('skills');
  if (skills) resume.skills = parseSkills(skills);
  const ai = sections.get('aiToolkit');
  if (ai) resume.aiToolkit = flatList(ai);

  const exp = sections.get('experience');
  if (exp) {
    resume.experience = parseExperience(exp, warnings);
  } else {
    warnings.push('No Experience section found; check the headings.');
  }
  const proj = sections.get('projects');
  if (proj) resume.projects = parseProjects(proj);
  const edu = sections.get('education');
  if (edu) resume.education = parseEducation(edu);
  const certs = sections.get('certifications');
  if (certs) resume.certifications = flatList(certs);

  if (!resume.contact.name) warnings.push('Could not find a name.');
  if (!resume.contact.email) warnings.push('Could not find an email address.');
  if (!resume.summary) warnings.push('No summary found.');
  if (resume.skills.length === 0) warnings.push('No skills found.');
  return { resume, warnings };
}

/* ---------- helpers ---------- */

function normaliseLines(input: string): string[] {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .split('\n')
    .map((l) => l.replace(/\s+$/g, '').replace(/^\s{0,3}/, ''))
    .map((l) => l.replace(/\s{2,}/g, ' ').trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''));
}

function headingKey(line: string): SectionKey | null {
  const bare = line.replace(/^[#\s]+|[:\s_-]+$/g, '').trim();
  if (!bare || wordCount(bare) > 4 || bare.length > 40) return null;
  if (BULLET.test(line)) return null;
  for (const [key, re] of HEADINGS) if (re.test(bare)) return key;
  return null;
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function paragraph(lines: string[]): string {
  return lines
    .filter(Boolean)
    .map((l) => l.replace(BULLET, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitList(s: string): string[] {
  return s
    .split(/\s*[,;|•·/]\s*|\s+[–—]\s+/)
    .map((x) => x.trim().replace(/\.$/, ''))
    .filter(Boolean);
}

function flatList(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const l = raw.replace(BULLET, '').trim();
    if (!l) continue;
    // "Name: a, b" rows still count as a list; bullet rows are one item each.
    if (BULLET.test(raw) || !/[,;|•·]/.test(l)) out.push(l);
    else out.push(...splitList(l));
  }
  return dedupe(out);
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parseHeader(
  header: string[],
  r: ResumeSections,
  warnings: string[],
): void {
  // Contact lines are often "a | b | c"; split them first.
  const tokens = header
    .filter((l) => wordCount(l) <= 16)
    .flatMap((l) =>
      EMAIL.test(l) || URL.test(l) || PHONE.test(l)
        ? l.split(/\s*[|•·]\s*/)
        : [l],
    )
    .map((t) => t.trim())
    .filter((t) => t && wordCount(t) <= 12);
  const rest: string[] = [];
  for (const t of tokens) {
    const email = t.match(EMAIL)?.[0];
    if (email && !r.contact.email) {
      r.contact.email = email;
      const leftover = t.replace(email, '').trim();
      if (leftover) rest.push(leftover);
      continue;
    }
    const url = t.match(URL)?.[0];
    if (url && !EMAIL.test(t)) {
      placeLink(r, url);
      continue;
    }
    const phone = t.match(PHONE)?.[0];
    if (phone && !/\d{4}\s*[-–]\s*\d{4}/.test(t) && !r.contact.phone) {
      r.contact.phone = phone.trim();
      continue;
    }
    rest.push(
      t.replace(/^(phone|tel|email|e-mail|location|address)\s*:\s*/i, ''),
    );
  }
  for (const t of rest) {
    const isName =
      !r.contact.name &&
      wordCount(t) >= 2 &&
      wordCount(t) <= 5 &&
      /^[A-Za-z][A-Za-z.'’ -]+$/.test(t) &&
      !TITLE_WORDS.test(t) &&
      !/,/.test(t);
    if (isName) {
      r.contact.name = t;
      continue;
    }
    if (!r.contact.headline && TITLE_WORDS.test(t) && wordCount(t) <= 10) {
      r.contact.headline = t;
      continue;
    }
    if (
      !r.contact.location &&
      /^[A-Za-z][A-Za-z .'-]*,\s*[A-Za-z][A-Za-z .'-]*$/.test(t) &&
      wordCount(t) <= 5
    ) {
      r.contact.location = t;
      continue;
    }
    if (
      !r.contact.location &&
      /\b(remote|dhaka|bangladesh)\b/i.test(t) &&
      wordCount(t) <= 4
    ) {
      r.contact.location = t;
    }
  }
  if (!r.contact.name && header[0] && wordCount(header[0]) <= 5) {
    r.contact.name = header[0];
    warnings.push('Guessed the name from the first line; check it.');
  }
}

function placeLink(r: ResumeSections, raw: string): void {
  const url = raw.replace(/[.,;)]+$/, '');
  const low = url.toLowerCase();
  const label = low.includes('linkedin')
    ? 'LinkedIn'
    : low.includes('github')
      ? 'GitHub'
      : low.includes('gitlab')
        ? 'GitLab'
        : '';
  if (!label && !r.contact.website) {
    r.contact.website = url;
    return;
  }
  if (!r.contact.links.some((l) => l.url === url))
    r.contact.links.push({ label: label || 'Website', url });
}

function parseSkills(lines: string[]): SkillGroup[] {
  const groups: SkillGroup[] = [];
  let pendingName = '';
  for (const raw of lines) {
    const l = raw.replace(BULLET, '').trim();
    if (!l) continue;
    const m = l.match(/^([A-Za-z][^:]{1,40}):\s*(.+)$/);
    if (m) {
      groups.push({ name: m[1].trim(), items: splitList(m[2]) });
      pendingName = '';
      continue;
    }
    if (wordCount(l) <= 4 && !/[,;|•·]/.test(l) && !BULLET.test(raw)) {
      // A short bare line is a group name; its items follow.
      pendingName = l.replace(/:$/, '');
      groups.push({ name: pendingName, items: [] });
      continue;
    }
    const items = splitList(l);
    const target = pendingName
      ? groups[groups.length - 1]
      : (groups.find((g) => g.name === 'Skills') ??
        (groups.push({ name: 'Skills', items: [] }),
        groups[groups.length - 1]));
    target.items.push(...items);
  }
  return groups
    .map((g) => ({ ...g, items: dedupe(g.items) }))
    .filter((g) => g.items.length > 0);
}

function parseDate(s: string): string {
  const t = s.trim().toLowerCase();
  if (/^(present|current|now|today|ongoing)$/.test(t)) return '';
  const my = t.match(new RegExp(`^(${MONTHS})\\s+(\\d{4})$`));
  if (my) {
    const mi =
      [
        'jan',
        'feb',
        'mar',
        'apr',
        'may',
        'jun',
        'jul',
        'aug',
        'sep',
        'oct',
        'nov',
        'dec',
      ].findIndex((m) => my[1].startsWith(m)) + 1;
    return `${my[2]}-${String(mi).padStart(2, '0')}`;
  }
  const num = t.match(/^(\d{1,2})[/.](\d{4})$/);
  if (num) return `${num[2]}-${num[1].padStart(2, '0')}`;
  const ym = t.match(/^(\d{4})-(\d{2})$/);
  if (ym) return `${ym[1]}-${ym[2]}`;
  const y = t.match(/^\d{4}$/);
  return y ? y[0] : '';
}

function parseExperience(
  lines: string[],
  warnings: string[],
): ExperienceEntry[] {
  const dateIdx = lines
    .map((l, i) => (RANGE.test(l) ? i : -1))
    .filter((i) => i >= 0);
  if (dateIdx.length === 0) {
    warnings.push(
      'No date ranges found in Experience; entries were kept as one block.',
    );
    const bullets = lines.filter(Boolean).map((l) => l.replace(BULLET, ''));
    return bullets.length
      ? [{ company: '', title: '', location: '', start: '', end: '', bullets }]
      : [];
  }
  const entries: ExperienceEntry[] = [];
  // Header of entry k = the date line plus up to two short non-bullet lines before it.
  const starts = dateIdx.map((di, k) => {
    let s = di;
    const floor = k === 0 ? -1 : dateIdx[k - 1];
    while (
      s - 1 > floor &&
      di - (s - 1) <= 2 &&
      lines[s - 1] !== '' &&
      !BULLET.test(lines[s - 1]) &&
      wordCount(lines[s - 1]) <= 10 &&
      !/[.!?]$/.test(lines[s - 1]) &&
      /^[A-Z0-9]/.test(lines[s - 1])
    )
      s--;
    return s;
  });
  for (let k = 0; k < dateIdx.length; k++) {
    const headerLines = lines.slice(starts[k], dateIdx[k] + 1);
    const bodyEnd = k + 1 < dateIdx.length ? starts[k + 1] : lines.length;
    const body = lines.slice(dateIdx[k] + 1, bodyEnd);
    const m = lines[dateIdx[k]].match(RANGE);
    if (!m) continue;
    const headerText = headerLines
      .map((l) => (l === lines[dateIdx[k]] ? l.replace(m[0], ' ') : l))
      .join(' | ');
    const clean = (ps: string[]) =>
      ps.map((p) => p.replace(/^[-,|(]+|[-,|)]+$/g, '').trim()).filter(Boolean);
    let parts = clean(headerText.split(/\s*(?:\||·|•|—|–| - | at | @ )\s*/));
    if (parts.length < 2) parts = clean(headerText.split(/\s*,\s*/));
    const e: ExperienceEntry = {
      company: '',
      title: '',
      location: '',
      start: parseDate(m[1]),
      end: parseDate(m[2]),
      bullets: [],
    };
    for (const p of parts) {
      if (!e.title && TITLE_WORDS.test(p)) e.title = p;
      else if (
        !e.location &&
        (/\bremote\b/i.test(p) ||
          /^[A-Za-z][A-Za-z .'-]*,\s*[A-Za-z][A-Za-z .'-]*$/.test(p))
      )
        e.location = p;
      else if (!e.company) e.company = p;
      else if (!e.title) e.title = p;
      else if (!e.location) e.location = p;
    }
    // Bullets: each bullet line is one; wrapped continuation lines join the previous.
    for (const raw of body) {
      if (!raw) continue;
      const text = raw.replace(BULLET, '').trim();
      if (!text) continue;
      const isNew =
        BULLET.test(raw) ||
        e.bullets.length === 0 ||
        /[.!?]$/.test(e.bullets[e.bullets.length - 1]);
      if (isNew) e.bullets.push(text);
      else e.bullets[e.bullets.length - 1] += ' ' + text;
    }
    entries.push(e);
  }
  return entries;
}

function parseProjects(lines: string[]): ProjectEntry[] {
  const projects: ProjectEntry[] = [];
  for (const raw of lines) {
    const l = raw.replace(BULLET, '').trim();
    if (!l) continue;
    const stack = l.match(
      /^(?:stack|tech(?:nologies)?|built with|tools)\s*:\s*(.+)$/i,
    );
    if (stack && projects.length) {
      projects[projects.length - 1].stack = splitList(stack[1]);
      continue;
    }
    const titled = l.match(/^([^:–—-]{2,60}?)\s*(?:[:–—]|\s-\s)\s*(.+)$/);
    const url = l.match(URL)?.[0] ?? '';
    const isNew = !BULLET.test(raw) && (titled !== null || wordCount(l) <= 8);
    if (isNew) {
      const name = (titled ? titled[1] : l)
        .replace(URL, '')
        .replace(/[()]/g, '')
        .trim();
      projects.push({
        name,
        url: url.replace(/[.,;)]+$/, ''),
        description: titled
          ? titled[2].replace(URL, '').replace(/[()]/g, '').trim()
          : '',
        stack: [],
      });
    } else if (projects.length) {
      const p = projects[projects.length - 1];
      if (url && !p.url) p.url = url.replace(/[.,;)]+$/, '');
      p.description = (p.description + ' ' + l.replace(URL, '')).trim();
    }
  }
  return projects;
}

function parseEducation(lines: string[]): EducationEntry[] {
  const out: EducationEntry[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    const text = buf.join(' | ');
    const year =
      text.match(/\b(19|20)\d{2}\b(?!.*\b(19|20)\d{2}\b)/)?.[0] ?? '';
    const parts = text
      .replace(RANGE, ' ')
      .replace(/\b(19|20)\d{2}\b/g, ' ')
      .split(/\s*(?:\||,|–|—| - )\s*/)
      .map((p) => p.replace(/^[-(|]+|[-)|]+$/g, '').trim())
      .filter(Boolean);
    const degree = parts.find((p) => DEGREE.test(p)) ?? '';
    const institution = parts.find((p) => p !== degree) ?? '';
    out.push({ institution, degree, year });
    buf = [];
  };
  for (const raw of lines) {
    const l = raw.replace(BULLET, '').trim();
    if (!l) {
      flush();
      continue;
    }
    buf.push(l);
    if (/\b(19|20)\d{2}\b/.test(l)) flush();
  }
  flush();
  return out.filter((e) => e.institution || e.degree);
}
