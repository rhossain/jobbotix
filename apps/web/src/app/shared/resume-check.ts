import { resumeWordCount, type ResumeSections } from '@jobbotix/shared-types';
import { pdfSafeResume } from './pdf-text';

/**
 * A check of the resume against what recruiters and applicant tracking
 * systems look for: the same things the public "resume checker" sites test,
 * without the parts that only sell a template. It runs in the browser on
 * every edit and costs nothing.
 *
 * Each check is a rule with a plain reason, worth some points; the score is
 * the points earned out of the points on offer. A rule that fails names the
 * exact lines, so there is always something to do about it. It measures how
 * the resume is written, not whether the person is right for a job: 100 does
 * not promise an interview.
 */

export type CheckArea =
  'contact' | 'sections' | 'impact' | 'wording' | 'format';

export const AREA_NAMES: Record<CheckArea, string> = {
  contact: 'Contact',
  sections: 'Sections',
  impact: 'Impact',
  wording: 'Wording',
  format: 'Length and format',
};

export interface CheckItem {
  /** The line or value the finding is about. */
  text: string;
  /** The id of the field to fix it in. */
  field?: string;
}

export interface CheckResult {
  id: string;
  area: CheckArea;
  /** What is checked, as a statement that is true when it passes. */
  title: string;
  /** Points earned and on offer. */
  points: number;
  max: number;
  ok: boolean;
  /** When it fails: what is wrong and what to do. */
  advice: string;
  items: CheckItem[];
  /** The fix is rewording, which the AI review can propose. */
  wording?: boolean;
}

export interface ResumeCheck {
  score: number;
  areas: {
    area: CheckArea;
    name: string;
    score: number;
    checks: CheckResult[];
  }[];
  failed: CheckResult[];
  passed: number;
  total: number;
}

const WEAK_OPENERS =
  /^(responsible for|worked on|worked with|helped|assisted|duties included|tasked with|participated in|involved in|in charge of|handled)\b/i;
const FIRST_PERSON = /^(i|my|we|our)\b/i;
const CLICHES = [
  'hard-working',
  'hardworking',
  'team player',
  'detail-oriented',
  'detail oriented',
  'results-driven',
  'results driven',
  'self-starter',
  'go-getter',
  'think outside the box',
  'synergy',
  'dynamic individual',
  'highly motivated',
  'passionate about',
  'proven track record',
  'fast learner',
  'quick learner',
];

/**
 * A figure that measures something: "38%", "$2M", "40+ clients", "6s",
 * "140 screens". A digit inside a name (HTML5, CSS3, 3D, Node.js 20) or a
 * calendar year is not one.
 */
export function hasMetric(text: string): boolean {
  const withoutYears = text.replace(/\b(19|20)\d{2}\b/g, ' ');
  return /(?<![A-Za-z0-9.])[$€£]?\d[\d,.]*\s?(%|\+|x|k|m|bn?|ms|s|hrs?|h)?(?![A-Za-z0-9])/i.test(
    withoutYears,
  );
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** Small slips a spell checker would catch without a dictionary. */
export function slips(text: string): string[] {
  const out: string[] = [];
  const doubled = text.match(/\b([A-Za-z]{2,})\s+\1\b/i);
  if (doubled) out.push(`"${doubled[0]}" repeats a word`);
  if (/ {2,}/.test(text.trim())) out.push('two spaces in a row');
  if (/\s[,.;:](\s|$)/.test(text)) out.push('a space before punctuation');
  if (/[,;:][A-Za-z]/.test(text.replace(/https?:\S+/g, '')))
    out.push('no space after a comma or colon');
  return out;
}

function monthIndex(v: string): number {
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(v.trim());
  return m ? Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0) : NaN;
}

export function checkResume(r: ResumeSections): ResumeCheck {
  const checks: CheckResult[] = [];
  const add = (
    c: Omit<CheckResult, 'points' | 'ok' | 'items'> & {
      /** 1 passes; a fraction earns part of the points. */
      earned: number;
      items?: CheckItem[];
    },
  ) => {
    const earned = Math.max(0, Math.min(1, c.earned));
    checks.push({
      id: c.id,
      area: c.area,
      title: c.title,
      max: c.max,
      points: Math.round(c.max * earned * 10) / 10,
      ok: earned >= 1,
      advice: c.advice,
      items: c.items ?? [],
      wording: c.wording,
    });
  };
  const yes = (b: boolean) => (b ? 1 : 0);

  // ---- Contact ---------------------------------------------------------
  const c = r.contact;
  const phoneDigits = c.phone.replace(/\D/g, '').length;
  add({
    id: 'name',
    area: 'contact',
    title: 'Your name is on it',
    max: 4,
    earned: yes(!!c.name.trim()),
    advice: 'Add your full name.',
    items: [{ text: 'Name is empty', field: 'rc-name' }],
  });
  add({
    id: 'email',
    area: 'contact',
    title: 'A working email address',
    max: 5,
    earned: yes(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email.trim())),
    advice: c.email.trim()
      ? 'That does not look like an email address.'
      : 'Add the email address employers should reply to.',
    items: [{ text: c.email.trim() || 'Email is empty', field: 'rc-email' }],
  });
  add({
    id: 'phone',
    area: 'contact',
    title: 'A phone number with its country code',
    max: 3,
    earned: phoneDigits < 7 ? 0 : /^\s*(\+|00)/.test(c.phone) ? 1 : 0.5,
    advice:
      phoneDigits < 7
        ? 'Add a phone number with the country code (+880 …): recruiters abroad need it to call.'
        : 'Start the number with the country code (+880 …). An employer abroad cannot dial a national number.',
    items: [{ text: c.phone.trim() || 'Phone is empty', field: 'rc-phone' }],
  });
  add({
    id: 'location',
    area: 'contact',
    title: 'Where you are based',
    max: 2,
    earned: yes(!!c.location.trim()),
    advice:
      'Add your city and country. For remote work, the country tells an employer whether they can hire you.',
    items: [{ text: 'Location is empty', field: 'rc-location' }],
  });
  const profiles = [c.website, ...c.links.map((l) => l.url)].join(' ');
  add({
    id: 'linkedin',
    area: 'contact',
    title: 'A LinkedIn profile',
    max: 3,
    earned: yes(/linkedin\.com\//i.test(profiles)),
    advice:
      'Add a line to Links: "LinkedIn | https://www.linkedin.com/in/your-name". Recruiters look for it, and resume checkers mark it missing.',
    items: [{ text: 'No LinkedIn link', field: 'rc-links' }],
  });
  add({
    id: 'headline',
    area: 'contact',
    title: 'A headline that names your role',
    max: 3,
    earned: yes(words(c.headline).length >= 2),
    advice:
      'Add a headline under your name, such as "Senior Frontend Engineer". It is the first thing matched against the job title.',
    items: [{ text: 'Headline is empty', field: 'rc-headline' }],
  });

  // ---- Sections --------------------------------------------------------
  const summaryWords = words(r.summary).length;
  add({
    id: 'summary',
    area: 'sections',
    title: 'A summary of 30 to 90 words',
    max: 6,
    earned:
      summaryWords === 0 ? 0 : summaryWords < 30 || summaryWords > 90 ? 0.5 : 1,
    advice:
      summaryWords === 0
        ? 'Add a summary: what you do, for how long, and what you are best at.'
        : summaryWords < 30
          ? `The summary is ${summaryWords} words. Say what you do, for how long, and what you are best at.`
          : `The summary is ${summaryWords} words. Cut it to the three things a recruiter must know.`,
    items: [{ text: `${summaryWords} words`, field: 'r-summary' }],
    wording: summaryWords > 0,
  });
  const incomplete = r.experience
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !e.title.trim() || !e.company.trim() || !e.start.trim());
  add({
    id: 'experience',
    area: 'sections',
    title: 'Experience, each role with a title, employer and start date',
    max: 7,
    earned: !r.experience.length
      ? 0
      : 1 - incomplete.length / r.experience.length,
    advice: !r.experience.length
      ? 'Add your work experience, newest first.'
      : 'Fill in what is missing: a parser files a role by its title, employer and dates.',
    items: !r.experience.length
      ? [{ text: 'No experience yet' }]
      : incomplete.map(({ e, i }) => ({
          text: `${e.title || 'No title'} at ${e.company || 'no employer'}${e.start ? '' : ', no start date'}`,
          field: !e.title.trim()
            ? `r-exp-title-${i}`
            : !e.company.trim()
              ? `r-exp-company-${i}`
              : `r-exp-start-${i}`,
        })),
  });
  add({
    id: 'education',
    area: 'sections',
    title: 'Education',
    max: 5,
    earned: yes(
      r.education.some((e) => e.degree.trim() || e.institution.trim()),
    ),
    advice:
      'Add your highest qualification, even from long ago. Many application systems filter on it, and checkers mark the section missing.',
    items: [{ text: 'No education yet' }],
  });
  const skillCount = r.skills.reduce((n, g) => n + g.items.length, 0);
  add({
    id: 'skills',
    area: 'sections',
    title: 'At least eight skills',
    max: 5,
    earned: Math.min(1, skillCount / 8),
    advice: `There ${skillCount === 1 ? 'is 1 skill' : `are ${skillCount} skills`}. List the tools and methods you use: the skills section is what keyword matching reads first.`,
    items: [{ text: `${skillCount} listed`, field: 'r-skill-items-0' }],
  });

  // ---- Impact ----------------------------------------------------------
  const bullets = r.experience.flatMap((e, i) =>
    e.bullets
      .map((b) => b.trim())
      .filter(Boolean)
      .map((text) => ({ text, i, role: e })),
  );
  const unmeasured = bullets.filter((b) => !hasMetric(b.text));
  const measuredShare = bullets.length
    ? 1 - unmeasured.length / bullets.length
    : 0;
  add({
    id: 'metrics',
    area: 'impact',
    title: 'At least half of your bullets carry a number',
    max: 16,
    earned: bullets.length ? Math.min(1, measuredShare / 0.5) : 0,
    advice: bullets.length
      ? `${unmeasured.length} of ${bullets.length} bullets have no figure. Add one you can stand behind: how many users, clients, screens or people, how much faster, how often. Only you know these numbers, so the AI review will not invent them.`
      : 'Add bullets to your roles first.',
    items: unmeasured.slice(0, 8).map((b) => ({
      text: b.text,
      field: `r-exp-bullets-${b.i}`,
    })),
  });
  const thin = r.experience
    .map((e, i) => ({ e, i, n: e.bullets.filter((b) => b.trim()).length }))
    // The two newest roles carry the resume; older ones may be a line.
    .filter(({ i, n }) => (i < 2 ? n < 3 || n > 7 : n > 7));
  add({
    id: 'bullet-count',
    area: 'impact',
    title: 'Three to seven bullets on your recent roles',
    max: 5,
    earned: r.experience.length ? yes(!thin.length) : 0,
    advice:
      'Fewer than three undersells a recent role; more than seven and the strong ones get lost. Keep the best.',
    items: thin.map(({ e, i, n }) => ({
      text: `${e.title || 'Role'} at ${e.company || 'employer'}: ${n} ${n === 1 ? 'bullet' : 'bullets'}`,
      field: `r-exp-bullets-${i}`,
    })),
  });

  // ---- Wording ---------------------------------------------------------
  // With no bullets there is nothing to judge: an empty resume earns no
  // credit for having no stock phrases in it.
  const none = 'Add bullets to your roles first.';
  const weak = bullets.filter(
    (b) => WEAK_OPENERS.test(b.text) || FIRST_PERSON.test(b.text),
  );
  add({
    id: 'openers',
    area: 'wording',
    title: 'Bullets open with an action, not a duty',
    max: 7,
    earned: bullets.length ? 1 - Math.min(1, weak.length / 3) : 0,
    advice:
      'Start with what you did: "Built", "Led", "Cut", "Shipped". Drop "Responsible for", "Worked on" and "I".',
    items: weak.slice(0, 8).map((b) => ({
      text: b.text,
      field: `r-exp-bullets-${b.i}`,
    })),
    wording: true,
  });
  const long = bullets.filter((b) => words(b.text).length > 34);
  add({
    id: 'long-bullets',
    area: 'wording',
    title: 'No bullet runs past two lines',
    max: 4,
    earned: bullets.length ? 1 - Math.min(1, long.length / 3) : 0,
    advice:
      'These run over 34 words. Split each into two, or cut it to the result and how you got it.',
    items: long.slice(0, 8).map((b) => ({
      text: b.text,
      field: `r-exp-bullets-${b.i}`,
    })),
    wording: true,
  });
  const prose = [r.summary, ...bullets.map((b) => b.text)]
    .join('\n')
    .toLowerCase();
  const cliches = CLICHES.filter((p) => prose.includes(p));
  add({
    id: 'cliches',
    area: 'wording',
    title: 'No stock phrases',
    max: 3,
    earned: bullets.length ? yes(!cliches.length) : 0,
    advice: !bullets.length
      ? none
      : 'These say nothing a recruiter can check. Replace each with the fact that proves it.',
    items: cliches.map((text) => ({ text })),
    wording: true,
  });
  const firstWords = new Map<string, number>();
  for (const b of bullets) {
    const w =
      words(b.text)[0]
        ?.toLowerCase()
        .replace(/[^a-z]/g, '') ?? '';
    if (w) firstWords.set(w, (firstWords.get(w) ?? 0) + 1);
  }
  const repeated = [...firstWords].filter(([, n]) => n >= 3);
  add({
    id: 'repetition',
    area: 'wording',
    title: 'Bullets do not keep starting with the same word',
    max: 4,
    earned: bullets.length ? yes(!repeated.length) : 0,
    advice: !bullets.length
      ? none
      : 'Vary the verb: the same opener three times reads as a list of chores.',
    items: repeated.map(([w, n]) => ({ text: `"${w}" opens ${n} bullets` })),
    wording: true,
  });
  const stops = bullets.filter((b) => /[.!]$/.test(b.text)).length;
  add({
    id: 'full-stops',
    area: 'wording',
    title: 'Bullets end the same way',
    max: 3,
    earned: bullets.length
      ? yes(!bullets.length || stops === 0 || stops === bullets.length)
      : 0,
    advice: !bullets.length
      ? none
      : `${stops} of ${bullets.length} bullets end with a full stop. Use one on all of them or on none.`,
    items: [],
    wording: true,
  });
  const slipped = [
    { text: r.summary, field: 'r-summary' },
    ...bullets.map((b) => ({ text: b.text, field: `r-exp-bullets-${b.i}` })),
    ...r.projects.map((p, i) => ({
      text: p.description,
      field: `r-proj-desc-${i}`,
    })),
  ]
    .map((x) => ({ ...x, found: slips(x.text) }))
    .filter((x) => x.found.length);
  add({
    id: 'slips',
    area: 'wording',
    title: 'No doubled words or stray spaces',
    max: 3,
    earned: bullets.length ? yes(!slipped.length) : 0,
    advice: !bullets.length
      ? none
      : 'Small slips read as carelessness. (This is not a spell check: the AI review reads for spelling and grammar.)',
    items: slipped.slice(0, 8).map((x) => ({
      text: `${x.found.join(', ')}: ${x.text.slice(0, 90)}`,
      field: x.field,
    })),
  });

  // ---- Length and format -------------------------------------------------
  const total = resumeWordCount(r);
  add({
    id: 'length',
    area: 'format',
    title: 'Between 300 and 850 words',
    max: 5,
    earned:
      total >= 300 && total <= 850
        ? 1
        : total >= 200 && total <= 1000
          ? 0.5
          : 0,
    advice:
      total < 300
        ? `The resume is ${total} words: too thin to judge. Add what you built and what came of it.`
        : `The resume is ${total} words: past two pages for most templates. Cut older roles to a line or two.`,
    items: [{ text: `${total} words` }],
  });
  const starts = r.experience.map((e) => monthIndex(e.start));
  const outOfOrder = starts.some(
    (s, i) =>
      i > 0 &&
      Number.isFinite(s) &&
      Number.isFinite(starts[i - 1]) &&
      s > starts[i - 1],
  );
  add({
    id: 'order',
    area: 'format',
    title: 'Roles run newest first',
    max: 4,
    earned: yes(r.experience.length > 0 && !outOfOrder),
    advice: r.experience.length
      ? 'Move your most recent role to the top with the arrows: recruiters and parsers both read the first role as the current one.'
      : 'Add your work experience, newest first.',
    items: [],
  });
  const dropped = pdfSafeResume(r).dropped;
  add({
    id: 'characters',
    area: 'format',
    title: 'Every character can be shown in the PDF',
    max: 3,
    earned: total ? yes(!dropped.length) : 0,
    advice:
      'The PDF font cannot show these, so the download leaves them out. Replace them, or use print and Save as PDF.',
    items: [{ text: dropped.slice(0, 12).join(' ') }],
  });

  // The points on offer add up to 100, so a check's points are its share.
  const max = checks.reduce((n, x) => n + x.max, 0);
  const got = checks.reduce((n, x) => n + x.points, 0);
  const areas = (Object.keys(AREA_NAMES) as CheckArea[]).map((area) => {
    const own = checks.filter((x) => x.area === area);
    const m = own.reduce((n, x) => n + x.max, 0);
    return {
      area,
      name: AREA_NAMES[area],
      score: m
        ? Math.round((own.reduce((n, x) => n + x.points, 0) / m) * 100)
        : 0,
      checks: own,
    };
  });
  const failed = checks
    .filter((x) => !x.ok)
    // what costs the most points first
    .sort((a, b) => b.max - b.points - (a.max - a.points));
  return {
    score: Math.round((got / max) * 100),
    areas,
    failed,
    passed: checks.length - failed.length,
    total: checks.length,
  };
}
