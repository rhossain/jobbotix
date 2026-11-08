/**
 * Heuristic resume parser: plain text (pasted, or extracted from a .docx or
 * PDF) → ResumeSections. It is deliberately forgiving: anything it cannot
 * place lands in the nearest section rather than being dropped, and the
 * warnings tell the user what to check. The editor is the second pass.
 *
 * What it understands beyond the obvious:
 * - headings by vocabulary, so "WORK EXPERIENCES", "Project URLs" and
 *   "Language Proficency" (sic) are all found, in any case, with or
 *   without a trailing colon or markdown #;
 * - skill ratings (★★★★☆, 4/5, 90%, "(Expert)") are stripped, and a flat
 *   skills list is sorted into groups, with soft skills and AI tools apart;
 * - spoken languages become a "Languages" skill group;
 * - education lines are paired degree ↔ institution, whichever comes first;
 * - a projects section of bare links becomes one project per link.
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
  | 'contact'
  | 'summary'
  | 'skills'
  | 'experience'
  | 'projects'
  | 'aiToolkit'
  | 'education'
  | 'certifications'
  | 'languages'
  | 'other';

/* ---------- headings ---------- */

/** Words a heading may contain that do not decide the section on their own. */
const FILLER = /* @__PURE__ */ new Set([
  'and',
  '&',
  'of',
  'my',
  'the',
  'in',
  'for',
  'key',
  'core',
  'main',
  'selected',
  'relevant',
  'notable',
  'personal',
  'professional',
  'technical',
  'work',
  'career',
  'other',
  'additional',
  'recent',
  'side',
  'open',
  'source',
  'me',
  'urls',
  'url',
  'list',
  'soft',
  'hard',
  'spoken',
  'summary',
]);

/** Section vocabulary, checked in priority order. */
const VOCAB: [SectionKey, RegExp][] = [
  ['languages', /^(languages?|lingu)/],
  [
    'certifications',
    /^(certific|licen[cs]|courses?|trainings?|awards?|honou?rs|achievements?|accomplishments?)/,
  ],
  [
    'education',
    /^(education|academic|qualification|degrees?|schooling|studies)/,
  ],
  ['experience', /^(experien|employment|history|positions?|jobs?)/],
  ['projects', /^(projects?|portfolio)/],
  [
    'skills',
    /^(skills?|competenc|technolog|stack|expertise|tools?|toolkit|tooling|proficien|profic|abilit|strengths?)/,
  ],
  [
    'summary',
    /^(summary|profile|about|objective|overview|introduction|intro|bio)$/,
  ],
  ['contact', /^(contact|details|information|info)$/],
  [
    'other',
    /^(interests?|hobbies|references?|volunteer\w*|publications?|activities|affiliations?|memberships?|extracurricular)$/,
  ],
];

const AI_WORD = /^(ai|genai|llm|llms|gen-ai)$/;
const TOOL_WORD = /^(tools?|toolkit|tooling|stack|workflow)$/;

function headingKeyOf(bare: string): SectionKey | null {
  const tokens = bare
    .toLowerCase()
    .replace(/[^a-z&\s-]/g, ' ')
    .split(/[\s/-]+/)
    .filter(Boolean);
  if (!tokens.length || tokens.length > 5) return null;
  if (
    tokens.some((t) => AI_WORD.test(t)) &&
    tokens.some((t) => TOOL_WORD.test(t))
  )
    return 'aiToolkit';
  const keys: SectionKey[] = [];
  for (const t of tokens) {
    const hit = VOCAB.find(([, re]) => re.test(t));
    if (hit) keys.push(hit[0]);
    else if (!FILLER.has(t) && !AI_WORD.test(t)) return null;
  }
  if (!keys.length) {
    // "Summary", "Career", "Professional Summary" are headings on their own.
    if (tokens.includes('summary')) return 'summary';
    if (tokens.includes('career') && tokens.length === 1) return 'experience';
    return null;
  }
  for (const [key] of VOCAB) if (keys.includes(key)) return key;
  return null;
}

function headingKey(line: string): SectionKey | null {
  if (BULLET.test(line)) return null;
  const bare = line
    .replace(/^[#*_\s]+|[:*_\s]+$/g, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
  if (!bare || bare.length > 45 || /[@\d|,.]/.test(bare)) return null;
  return headingKeyOf(bare);
}

/** "Skills: Angular, React" → a heading with content on the same line. */
function inlineHeading(
  line: string,
): { key: SectionKey; label: string; rest: string } | null {
  const m = line.match(/^([A-Za-z][A-Za-z &/]{2,30}):\s*(.+)$/);
  if (!m || BULLET.test(line)) return null;
  const key = headingKeyOf(m[1]);
  return key && key !== 'contact'
    ? { key, label: m[1], rest: m[2].trim() }
    : null;
}

interface Block {
  key: SectionKey | 'unknown' | null;
  heading: string;
  lines: string[];
}

const SECTION_NAMES: Record<SectionKey, string> = {
  contact: 'contact details',
  summary: 'the summary',
  skills: 'skills',
  experience: 'experience',
  projects: 'projects',
  aiToolkit: 'the AI toolkit',
  education: 'education',
  certifications: 'certifications',
  languages: 'languages',
  other: 'other',
};

/** A short ALL-CAPS line we have no word for ("WHERE I'VE WORKED"). */
function isUnknownHeading(line: string): boolean {
  if (BULLET.test(line) || /[@\d|,]/.test(line) || /[.!?]$/.test(line))
    return false;
  const bare = line.replace(/:$/, '').trim();
  return (
    wordCount(bare) <= 4 &&
    /\p{Lu}.*\p{Lu}.*\p{Lu}/u.test(bare) &&
    !/\p{Ll}/u.test(bare) &&
    !URL.test(bare) &&
    !RATING.test(bare)
  );
}

function rolesNear(lines: string[], i: number): boolean {
  return lines
    .slice(Math.max(0, i - 2), i + 3)
    .some((l) => TITLE_WORDS.test(l) && !BULLET.test(l));
}

function hasRoles(lines: string[]): boolean {
  return lines.some(
    (l, i) => RANGE.test(l) && !BULLET.test(l) && rolesNear(lines, i),
  );
}

function guessSection(lines: string[]): SectionKey {
  const text = lines.filter(Boolean);
  if (!text.length) return 'other';
  if (hasRoles(lines)) return 'experience';
  if (text.some((l) => DEGREE.test(l)) && text.some((l) => INSTITUTION.test(l)))
    return 'education';
  if (
    text.every((l) =>
      HUMAN_LANGUAGES.test(stripRating(l.replace(BULLET, '')).name),
    )
  )
    return 'languages';
  const listy = text.filter(
    (l) => wordCount(l.replace(BULLET, '')) <= 4 || /,/.test(l),
  );
  if (listy.length / text.length > 0.8 && text.some((l) => looksLikeSkill(l)))
    return 'skills';
  if (text.length <= 6 && text.every((l) => wordCount(l) > 12))
    return 'summary';
  return 'other';
}

/* ---------- shared patterns ---------- */

const MONTHS =
  '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE = `(?:${MONTHS}\\s*,?\\s*\\d{4}|\\d{1,2}[/.]\\d{4}|\\d{4}(?:[-/.]\\d{2}(?!\\d))?)`;
const RANGE = /* @__PURE__ */ new RegExp(
  `\\(?(${DATE})\\s*(?:[-–—]+|to|until|till)\\s*(${DATE}|present|current|now|today|ongoing|till date|to date|date)\\)?`,
  'i',
);
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const TLDS =
  'com|io|dev|me|net|org|app|co|ai|life|tech|info|biz|xyz|site|online|store|shop|design|studio|page|so|us|uk|bd|in|de|ca|au|eu|gg|tv|cc|ly|sh|link|live|blog|digital|agency|cloud|codes|works|website|world|space|pro';
const URL = /* @__PURE__ */ new RegExp(
  `(?:https?:\\/\\/|www\\.)[^\\s|,;]+|(?:[\\w-]+\\.)+(?:${TLDS})(?![\\w-])(?:\\/[^\\s|,;]*)?`,
  'i',
);
const BULLET = /^\s*(?:[-*•·▪◦‣●■□➢➤►✓✔]|\d+[.)])\s+/;
const TITLE_WORDS =
  /\b(engineer|developer|programmer|manager|lead|architect|designer|consultant|intern|analyst|director|head|specialist|founder|officer|cto|ceo|vp|president|administrator|scientist|researcher|coordinator|associate|assistant|teacher|instructor|freelancer?|contractor)\b/i;
/** Suffixes that make a part a company even when it contains a title word. */
const COMPANY_SUFFIX =
  /\b(ltd|limited|inc|llc|llp|gmbh|corp|corporation|plc|pvt|s\.?a|ag|bv|co)\b\.?|\b(solutions|technologies|labs|studios?|agency|group|systems|digital|consulting)\b/i;
const DEGREE =
  /\b(b\.?\s?sc|m\.?\s?sc|b\.?\s?a|m\.?\s?a|b\.?\s?eng|m\.?\s?eng|b\.?\s?tech|m\.?\s?tech|bachelor|master|mba|ph\.?d|doctor|diploma|associate|hsc|ssc|a-levels?|o-levels?|high school|bs|ms|bba|bcs|mcs|certificate in)\b/i;
const INSTITUTION =
  /\b(universit\w*|college|institute|institution|school|academy|polytechnic|education|faculty|campus)\b/i;

const RATING_FILLED = '★⭐●◉■';
const RATING_EMPTY = '☆✩○◯□';
const RATING = /* @__PURE__ */ new RegExp(`[${RATING_FILLED}${RATING_EMPTY}]`);

const HUMAN_LANGUAGES =
  /^(english|bengali|bangla|hindi|urdu|arabic|spanish|french|german|italian|portuguese|russian|chinese|mandarin|cantonese|japanese|korean|turkish|dutch|swedish|norwegian|danish|finnish|polish|greek|hebrew|persian|farsi|malay|indonesian|thai|vietnamese|tagalog|filipino|swahili|tamil|telugu|punjabi|nepali|sinhala|ukrainian|romanian|czech|hungarian|gujarati|marathi|kannada|malayalam)$/i;
const LANGUAGE_LEVELS = [
  'Basic',
  'Conversational',
  'Professional',
  'Fluent',
  'Native',
];

/* ---------- entry point ---------- */

export function parseResumeText(input: string): ResumeImport {
  const warnings: string[] = [];
  const resume = emptyResume();
  const lines = normaliseLines(input);
  if (lines.length === 0) return { resume, warnings: ['Nothing to import.'] };

  // Split into blocks: the header, then one block per heading.
  const blocks: Block[] = [{ key: null, heading: '', lines: [] }];
  const open = (key: SectionKey | 'unknown', heading: string) =>
    blocks.push({ key, heading, lines: [] });
  for (const line of lines) {
    const cur = blocks[blocks.length - 1];
    const key = headingKey(line);
    if (key) {
      // "TOOLS" inside Skills is a group name, not a new section.
      if (key === 'skills' && cur.key === 'skills') cur.lines.push(line);
      else open(key, line.replace(/:$/, ''));
      continue;
    }
    if (blocks.length > 1 && cur.key !== 'skills' && isUnknownHeading(line)) {
      open('unknown', line.replace(/:$/, ''));
      continue;
    }
    const inline =
      cur.key !== 'skills' && cur.key !== 'projects'
        ? inlineHeading(line)
        : null;
    if (inline && inline.key !== cur.key) {
      open(inline.key, inline.label);
      blocks[blocks.length - 1].lines.push(inline.rest);
      continue;
    }
    cur.lines.push(line);
  }
  // Sections under headings we do not know are placed by what is in them.
  for (const b of blocks) {
    if (b.key !== 'unknown') continue;
    b.key = guessSection(b.lines);
    if (b.key !== 'other')
      warnings.push(
        `Read "${titleCase(b.heading)}" as ${SECTION_NAMES[b.key]}; check it.`,
      );
  }
  // No Experience heading at all: look for roles anywhere outside known sections.
  if (!blocks.some((b) => b.key === 'experience')) {
    const host = blocks.find(
      (b) =>
        (b.key === null || b.key === 'other' || b.key === 'summary') &&
        hasRoles(b.lines),
    );
    if (host) {
      const first = host.lines.findIndex(
        (l, i) => RANGE.test(l) && rolesNear(host.lines, i),
      );
      const from = Math.max(0, first - 2);
      blocks.push({
        key: 'experience',
        heading: '',
        lines: host.lines.slice(from),
      });
      host.lines = host.lines.slice(0, from);
      warnings.push('Found roles without an Experience heading; check them.');
    }
  }

  const sections = new Map<SectionKey, string[]>();
  const headingsSeen = new Map<SectionKey, string>();
  const header: string[] = [];
  for (const b of blocks) {
    const key = b.key as SectionKey | null;
    if (!key || key === 'contact') {
      header.push(...b.lines);
      continue;
    }
    sections.set(key, [...(sections.get(key) ?? []), '', ...b.lines]);
    if (!headingsSeen.has(key) && b.heading) headingsSeen.set(key, b.heading);
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
  if (skills) resume.skills = parseSkills(skills, resume);
  const ai = sections.get('aiToolkit');
  if (ai) resume.aiToolkit = dedupe([...resume.aiToolkit, ...flatList(ai)]);
  pullSpokenLanguages(resume);
  const langs = sections.get('languages');
  if (langs) addLanguages(resume, flatList(langs, true));

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

  // A headline is the first thing a recruiter reads; borrow the latest title.
  if (!resume.contact.headline && resume.experience[0]?.title) {
    resume.contact.headline = resume.experience[0].title;
    warnings.push(
      `No headline found; used your latest title ("${resume.contact.headline}"). Edit it to the role you want.`,
    );
  }

  if (!resume.contact.name) warnings.push('Could not find a name.');
  if (!resume.contact.email) warnings.push('Could not find an email address.');
  if (!resume.summary) warnings.push('No summary found.');
  if (resume.skills.length === 0) warnings.push('No skills found.');
  resume.experience.forEach((e, i) => {
    const label = e.title || e.company || `Role ${i + 1}`;
    const missing = [
      !e.title && 'job title',
      !e.company && 'company',
      !e.start && 'start date',
    ].filter(Boolean);
    if (missing.length)
      warnings.push(`${label}: no ${missing.join(' or ')} found.`);
  });
  const bare = resume.projects.filter((p) => !p.description).length;
  if (bare)
    warnings.push(
      `${bare} project${bare === 1 ? ' has' : 's have'} only a link; add a line on what each one is.`,
    );
  const skipped = sections.get('other');
  if (skipped?.some(Boolean))
    warnings.push(
      `Skipped "${titleCase(headingsSeen.get('other') ?? 'Other')}": the resume has no place for it.`,
    );
  return { resume, warnings };
}

/* ---------- helpers ---------- */

/** "E X P E R I E N C E" (designed resumes) → "EXPERIENCE". */
function unLetterSpace(line: string): string {
  if (!/^(\p{L} ){3,}\p{L}/u.test(line.trim())) return line;
  return line
    .trim()
    .split(/\s{2,}/)
    .map((w) => (/^(\p{L} )+\p{L}$/u.test(w) ? w.replace(/ /g, '') : w))
    .join(' ');
}

function normaliseLines(input: string): string[] {
  return input
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\t+/g, ' | ')
    .split('\n')
    .map(unLetterSpace)
    .join('\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
    .split('\n')
    .map((l) =>
      l
        .replace(/^[\s|]+|[\s|]+$/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,;])/g, '$1')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')
        .replace(/\s*[·•]+$/, '')
        .trim(),
    )
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''));
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function titleCase(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(
        /(^|[\s.-])(\p{L})/gu,
        (_, p: string, c: string) => p + c.toUpperCase(),
      )
      // O'Brien, but I've and Don't.
      .replace(
        /\b(\p{L})'(\p{L}{3,})/gu,
        (_, a: string, b: string) => `${a}'${b[0].toUpperCase()}${b.slice(1)}`,
      )
      .replace(/\b(Ii|Iii|Iv)\b/g, (r) => r.toUpperCase())
  );
}

function paragraph(lines: string[]): string {
  return lines
    .filter(Boolean)
    .map((l) => l.replace(BULLET, ''))
    .join(' ')
    .replace(/(\w)- (\w)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitList(s: string): string[] {
  return s
    .split(/\s*[,;|•·]\s*|\s+[–—]\s+|\s+\/\s+/)
    .map((x) => x.trim().replace(/\.$/, ''))
    .filter(Boolean);
}

/** Removes a rating from a skill; returns the clean name and a 1–5 score. */
function stripRating(raw: string): { name: string; score: number | null } {
  let score: number | null = null;
  let s = raw;
  const stars = s.match(new RegExp(`[${RATING_FILLED}${RATING_EMPTY}]+`));
  if (stars) {
    const filled = [...stars[0]].filter((c) =>
      RATING_FILLED.includes(c),
    ).length;
    score = Math.round((filled / stars[0].length) * 5);
    s = s.replace(
      new RegExp(`\\(?\\s*[${RATING_FILLED}${RATING_EMPTY}]+\\s*\\)?`, 'g'),
      ' ',
    );
  }
  const outOf = s.match(/\(?\s*(\d(?:\.\d)?)\s*\/\s*(5|10)\s*\)?/);
  if (outOf) {
    score = Math.round((Number(outOf[1]) / Number(outOf[2])) * 5);
    s = s.replace(outOf[0], ' ');
  }
  const pct = s.match(/[-–:(]?\s*(\d{1,3})\s*%\s*\)?/);
  if (pct && Number(pct[1]) <= 100) {
    score = Math.max(1, Math.round(Number(pct[1]) / 20));
    s = s.replace(pct[0], ' ');
  }
  s = s.replace(
    /\s*(?:[-–:]\s*|\()\s*(beginner|elementary|basic|intermediate|good|advanced|expert|proficient|excellent|fluent|native|bilingual|mother tongue|conversational|professional working|working)\s*(proficiency)?\)?\s*$/i,
    (m, level: string) => {
      const l = level.toLowerCase();
      score = /native|bilingual|mother/.test(l)
        ? 5
        : /expert|fluent|excellent/.test(l)
          ? 4
          : /advanced|proficient|professional|working|good/.test(l)
            ? 3
            : /intermediate|conversational/.test(l)
              ? 2
              : 1;
      return ' ';
    },
  );
  return {
    name: s
      .replace(/\s+/g, ' ')
      .replace(/[\s:(-]+$/, '')
      .trim(),
    score,
  };
}

function flatList(lines: string[], keepRatings = false): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const l = raw.replace(BULLET, '').trim();
    if (!l) continue;
    // Bullet rows are one item each unless they carry several bullets.
    const items =
      (BULLET.test(raw) && !/\s[•·|]\s/.test(l)) || !/[,;|•·]/.test(l)
        ? [l]
        : splitList(l);
    for (const it of items) {
      if (keepRatings) out.push(it);
      else {
        const { name } = stripRating(it);
        if (name) out.push(name);
      }
    }
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

function normaliseUrl(raw: string): string {
  const url = raw.replace(/[.,;)\]]+$/, '');
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
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
  for (const raw of tokens) {
    const t = raw.replace(
      /^(phone|mobile|cell|tel|email|e-mail|location|address|linkedin|github|website|portfolio|web)\s*:\s*/i,
      '',
    );
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
    rest.push(t);
  }
  for (const t of rest) {
    const isName =
      !r.contact.name &&
      wordCount(t) >= 2 &&
      wordCount(t) <= 5 &&
      /^\p{L}[\p{L}.' -]+$/u.test(t) &&
      !TITLE_WORDS.test(t) &&
      !/,/.test(t);
    if (isName) {
      r.contact.name = /\p{Ll}/u.test(t) ? t : titleCase(t);
      continue;
    }
    if (!r.contact.headline && TITLE_WORDS.test(t) && wordCount(t) <= 10) {
      r.contact.headline = t;
      continue;
    }
    if (
      !r.contact.location &&
      /^\p{L}[\p{L} .'-]*(,\s*[\p{L}\d][\p{L}\d .'-]*){1,3}$/u.test(t) &&
      wordCount(t) <= 6 &&
      !TITLE_WORDS.test(t)
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
  const url = normaliseUrl(raw);
  const low = url.toLowerCase();
  const label = low.includes('linkedin')
    ? 'LinkedIn'
    : low.includes('github')
      ? 'GitHub'
      : low.includes('gitlab')
        ? 'GitLab'
        : low.includes('behance')
          ? 'Behance'
          : low.includes('dribbble')
            ? 'Dribbble'
            : '';
  if (!label && !r.contact.website) {
    r.contact.website = url;
    return;
  }
  if (!r.contact.links.some((l) => l.url === url))
    r.contact.links.push({ label: label || 'Website', url });
}

/* ---------- skills ---------- */

/** Groups for a flat skills list, checked in order; first match wins. */
const SKILL_GROUPS: [string, RegExp][] = [
  [
    'AI tools',
    /\b(copilot|claude|chatgpt|gpt-?\d?|cursor|gemini|windsurf|v0|lovable|codeium|tabnine|midjourney|llms?|prompt engineering)\b/i,
  ],
  [
    'Soft skills',
    /\b(team ?work|team player|communicat\w*|leadership|problem[- ]solving|multi-?task\w*|prioriti[sz]\w*|time management|collaborat\w*|adaptab\w*|mentor\w*|critical thinking|attention to detail|creativ\w*|negotiat\w*|presentation|stakeholder\w*|ownership|self[- ]motivat\w*|organi[sz]ation\w*|interpersonal|decision[- ]making|analytical)\b/i,
  ],
  [
    'Styling & UI',
    /\b(css3?|scss|sass|less|tailwind\w*|bootstrap|material|mui|chakra|styled[- ]components|responsive|bem|bulma|primeng|ant design|foundation)\b/i,
  ],
  [
    'CMS & e-commerce',
    /\b(wordpress|woocommerce|nopcommerce|shopify|magento|joomla|drupal|strapi|contentful|sanity|umbraco|prestashop|opencart|bigcommerce|webflow|elementor|wix)\b/i,
  ],
  [
    'Frontend',
    /\b(angular(js)?|react(\.?js)?|vue(\.?js)?|svelte|next\.?js|nuxt|ember|typescript|javascript|es\d+|jquery|rxjs|ngrx|redux|html5?|pwa|web components|signals|ajax|json)\b/i,
  ],
  [
    'Backend & data',
    /(\b(node(\.?js)?|express|nest(js)?|php|laravel|python|django|flask|java|spring|ruby|rails|golang|mysql|postgres\w*|mongo\w*|sql|graphql|rest(ful)?|firebase|supabase|redis|apis?)\b|\.net\b|\bc#)/i,
  ],
  [
    'Design',
    /\b(figma|sketch|adobe|xd|photoshop|illustrator|invision|zeplin|ux|ui\/ux|prototyp\w*|wirefram\w*)\b/i,
  ],
  [
    'Tools',
    /\b(git\w*|bitbucket|jira|confluence|docker|kubernetes|webpack|vite|npm|yarn|pnpm|nx|ci\/cd|jenkins|jest|karma|jasmine|cypress|playwright|storybook|vs ?code|aws|azure|gcp|vercel|netlify|linux|agile|scrum|seo)\b/i,
  ],
];
const GROUP_ORDER = [
  'Frontend',
  'Styling & UI',
  'CMS & e-commerce',
  'Backend & data',
  'Design',
  'Tools',
  'Other',
  'Soft skills',
];

function parseSkills(lines: string[], r: ResumeSections): SkillGroup[] {
  const groups: SkillGroup[] = [];
  let pendingName = '';
  for (const raw of lines) {
    const l = raw.replace(BULLET, '').trim();
    if (!l) continue;
    // "Frontend: a, b" or a table row "Frontend | a, b" names a group.
    const m =
      l.match(/^([A-Za-z][^:]{1,40}):\s*(.+)$/) ??
      l.match(/^([A-Za-z][^|,;]{1,30}?)\s*\|\s*(.+[,;].+)$/);
    if (m && !RATING.test(m[1]) && wordCount(m[1]) <= 4) {
      groups.push({ name: m[1].trim(), items: cleanItems(splitList(m[2])) });
      pendingName = '';
      continue;
    }
    if (
      wordCount(l) <= 4 &&
      !/[,;|•·]/.test(l) &&
      !BULLET.test(raw) &&
      !RATING.test(l) &&
      (/:$/.test(l) || /^\p{Lu}/u.test(l)) &&
      lines.length > 1 &&
      !looksLikeSkill(l)
    ) {
      // A short bare line is a group name; its items follow.
      pendingName = l.replace(/:$/, '');
      groups.push({ name: pendingName, items: [] });
      continue;
    }
    const items = cleanItems(splitList(l));
    const target = pendingName
      ? groups[groups.length - 1]
      : (groups.find((g) => g.name === 'Skills') ??
        (groups.push({ name: 'Skills', items: [] }),
        groups[groups.length - 1]));
    target.items.push(...items);
  }
  const out = groups
    .map((g) => ({ ...g, items: dedupe(g.items) }))
    .filter((g) => g.items.length > 0);
  // A single ungrouped list is sorted into groups the editor can work with.
  if (out.length === 1 && out[0].name === 'Skills' && out[0].items.length >= 6)
    return autoGroup(out[0].items, r) ?? out;
  return out;
}

function cleanItems(items: string[]): string[] {
  return items.map((i) => stripRating(i).name).filter(Boolean);
}

function looksLikeSkill(l: string): boolean {
  return SKILL_GROUPS.some(([, re]) => re.test(l));
}

function autoGroup(items: string[], r: ResumeSections): SkillGroup[] | null {
  const byGroup = new Map<string, string[]>();
  let unknown = 0;
  for (const item of items) {
    const name = SKILL_GROUPS.find(([, re]) => re.test(item))?.[0] ?? 'Other';
    if (name === 'Other') unknown++;
    byGroup.set(name, [...(byGroup.get(name) ?? []), item]);
  }
  if (unknown > items.length * 0.4) return null;
  const ai = byGroup.get('AI tools');
  if (ai) r.aiToolkit = dedupe([...r.aiToolkit, ...ai]);
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
    name: g,
    items: byGroup.get(g) ?? [],
  }));
}

/** Spoken languages go in a "Languages" skill group, with a level in words. */
function addLanguages(r: ResumeSections, raw: string[]): void {
  const items = raw
    .map((x) => {
      const { name, score } = stripRating(x);
      if (!name) return '';
      return score
        ? `${name} (${LANGUAGE_LEVELS[Math.min(5, Math.max(1, score)) - 1]})`
        : name;
    })
    .filter(Boolean);
  if (!items.length) return;
  const group = r.skills.find((g) => g.name === 'Languages');
  if (group) group.items = dedupe([...group.items, ...items]);
  else r.skills.push({ name: 'Languages', items });
}

/** A skills group of only spoken languages (e.g. "Languages: English, Bangla"). */
function pullSpokenLanguages(r: ResumeSections): void {
  for (const g of r.skills) {
    if (!/^languages?$/i.test(g.name)) continue;
    const spoken = g.items.every((i) =>
      HUMAN_LANGUAGES.test(i.replace(/\s*\(.*\)$/, '').trim()),
    );
    g.name = spoken ? 'Languages' : 'Programming languages';
  }
}

/* ---------- experience ---------- */

function parseDate(s: string): string {
  const t = s.trim().toLowerCase().replace(/,/g, '');
  if (/^(present|current|now|today|ongoing|till date|to date|date)$/.test(t))
    return '';
  const my = t.match(new RegExp(`^(${MONTHS})\\s*(\\d{4})$`));
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
  const ym = t.match(/^(\d{4})[-/.](\d{2})$/);
  if (ym) return `${ym[1]}-${ym[2]}`;
  const y = t.match(/^\d{4}$/);
  return y ? y[0] : '';
}

function parseExperience(
  lines: string[],
  warnings: string[],
): ExperienceEntry[] {
  const dateIdx = lines
    .map((l, i) => (RANGE.test(l) && !BULLET.test(l) ? i : -1))
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
      /^[\p{Lu}0-9]/u.test(lines[s - 1])
    )
      s--;
    return s;
  });
  const isHeadish = (l: string | undefined) =>
    !!l &&
    !BULLET.test(l) &&
    wordCount(l) <= 10 &&
    !/[.!?]$/.test(l) &&
    !RANGE.test(l);
  for (let k = 0; k < dateIdx.length; k++) {
    const di = dateIdx[k];
    const m = lines[di].match(RANGE);
    if (!m) continue;
    const bodyEnd = k + 1 < dateIdx.length ? starts[k + 1] : lines.length;
    let headerLines = lines.slice(starts[k], di + 1);
    let bodyStart = di + 1;
    // Date-first layout: a bare date line with the title/company under it.
    const dateOnly =
      lines[di].replace(m[0], '').replace(/[\s|,:()-]+/g, '') === '';
    if (dateOnly && starts[k] === di) {
      while (
        bodyStart < bodyEnd &&
        bodyStart - di <= 2 &&
        isHeadish(lines[bodyStart])
      )
        bodyStart++;
      headerLines = lines.slice(di, bodyStart);
    }
    const body = lines.slice(bodyStart, bodyEnd);
    const headerText = headerLines
      .map((l) => (l === lines[di] ? l.replace(m[0], ' ') : l))
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
      const companyLike = COMPANY_SUFFIX.test(p);
      if (
        !e.title &&
        TITLE_WORDS.test(p) &&
        !/\b(ltd|limited|inc|llc|gmbh|corp|plc|pvt)\b/i.test(p)
      )
        e.title = p;
      else if (
        !e.location &&
        !companyLike &&
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
      const text = raw
        .replace(BULLET, '')
        .replace(/\s*[·•]+$/, '')
        .trim();
      if (!text) continue;
      const isNew =
        BULLET.test(raw) ||
        e.bullets.length === 0 ||
        /[.!?]$/.test(e.bullets[e.bullets.length - 1]);
      if (isNew) e.bullets.push(text);
      else {
        const prev = e.bullets[e.bullets.length - 1];
        // "front-" + "end" was one word split by the line wrap.
        e.bullets[e.bullets.length - 1] = /\p{Ll}-$/u.test(prev)
          ? prev + text
          : `${prev} ${text}`;
      }
    }
    entries.push(e);
  }
  return entries;
}

/* ---------- projects ---------- */

/** "https://nop-kalles.nop-station.com/" → "Nop Kalles". */
function nameFromUrl(url: string): string {
  const u = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const [host, ...path] = u.split('/');
  const labels = host.split('.');
  const segs = path.filter((p) => p && !/^(index|home)(\.\w+)?$/i.test(p));
  const pick = segs.length ? segs[segs.length - 1] : labels[0];
  return titleCase(pick.replace(/\.\w+$/, '').replace(/[-_]+/g, ' '));
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
    const url = l.match(URL)?.[0] ?? '';
    // A line that is only a link is a project of its own.
    if (url && l.replace(url, '').replace(/[\s|,;:()-]+/g, '') === '') {
      projects.push({
        name: nameFromUrl(url),
        url: normaliseUrl(url),
        description: '',
        stack: [],
      });
      continue;
    }
    const titled = l.match(/^([^:–—-]{2,60}?)\s*(?:[:–—]|\s-\s)\s*(.+)$/);
    const isNew = !BULLET.test(raw) && (titled !== null || wordCount(l) <= 8);
    if (isNew) {
      const name = (titled ? titled[1] : l)
        .replace(URL, '')
        .replace(/[()]/g, '')
        .trim();
      projects.push({
        name: name || (url ? nameFromUrl(url) : ''),
        url: url ? normaliseUrl(url) : '',
        description: titled
          ? titled[2]
              .replace(URL, '')
              .replace(/[()]/g, '')
              .replace(/\s+/g, ' ')
              .trim()
          : '',
        stack: [],
      });
    } else if (projects.length) {
      const p = projects[projects.length - 1];
      if (url && !p.url) p.url = normaliseUrl(url);
      p.description = (p.description + ' ' + l.replace(URL, '')).trim();
    }
  }
  return projects.filter((p) => p.name || p.url);
}

/* ---------- education ---------- */

function parseEducation(lines: string[]): EducationEntry[] {
  const out: EducationEntry[] = [];
  let cur: EducationEntry = { institution: '', degree: '', year: '' };
  const flush = () => {
    if (cur.institution || cur.degree) out.push(cur);
    cur = { institution: '', degree: '', year: '' };
  };
  for (const raw of lines) {
    const l = raw.replace(BULLET, '').trim();
    if (!l) continue;
    const years = l.match(/\b(19|20)\d{2}\b/g) ?? [];
    const year = years[years.length - 1] ?? '';
    const parts = l
      .replace(RANGE, ' ')
      .replace(/\b(19|20)\d{2}\b/g, ' ')
      .split(/\s*(?:\||,|–|—| - )\s*/)
      .map((p) => p.replace(/^[-(|]+|[-)|]+$/g, '').trim())
      .filter(Boolean);
    let degree = '';
    let institution = '';
    const extra: string[] = [];
    for (const p of parts) {
      if (
        !degree &&
        DEGREE.test(p) &&
        !(INSTITUTION.test(p) && !/\bin\b/i.test(p))
      )
        degree = p;
      else if (!institution && INSTITUTION.test(p)) institution = p;
      else extra.push(p);
    }
    // An unlabelled lone line fills whichever half the entry is missing.
    if (
      !degree &&
      !institution &&
      extra.length &&
      !/^(gpa|cgpa|grade|result)/i.test(extra[0])
    ) {
      if (cur.degree && !cur.institution) institution = extra.shift() ?? '';
      else if (!cur.degree) degree = extra.shift() ?? '';
    }
    if (institution && extra.length && extra.every((x) => wordCount(x) <= 3))
      institution = [institution, ...extra].join(', ');
    // A second degree or a second institution means a new entry.
    if ((degree && cur.degree) || (institution && cur.institution)) flush();
    if (degree) cur.degree = degree;
    if (institution) cur.institution = institution;
    if (year && !cur.year) cur.year = year;
  }
  flush();
  return out;
}
