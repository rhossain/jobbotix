import { linkedInJobId, linkedInJobUrl } from '@jobbotix/shared-types';
import {
  emptyResume,
  type EducationEntry,
  type ExperienceEntry,
  type ResumeSections,
} from '@jobbotix/shared-types';
import { parseCsv } from './csv';

/**
 * Reading the archive LinkedIn gives a member from "Get a copy of your data"
 * (Settings, Data privacy). The member downloads it themselves and hands it
 * to Jobbotix; Jobbotix never contacts LinkedIn. Everything here runs in the
 * browser, on a handful of the archive's CSV files:
 *
 *  - Saved Jobs and Job Applications become jobs in the pipeline,
 *  - Connections become the "who you know" list,
 *  - Profile, Positions, Education, Skills and Certifications fill a resume.
 *
 * Every other file in the archive (messages, invitations, searches, ads…) is
 * never opened: `linkedInFileKind` names the only files that are read. And
 * within those, columns that hold someone else's contact details (a
 * connection's email address, a recruiter's email or phone) are never read.
 */

export type LinkedInFileKind =
  | 'savedJobs'
  | 'applications'
  | 'connections'
  | 'profile'
  | 'positions'
  | 'education'
  | 'skills'
  | 'certifications'
  | 'emails';

/** File name (without folders, extension or a "_1" part number) -> what it is. */
const FILE_KINDS: Record<string, LinkedInFileKind> = {
  'saved jobs': 'savedJobs',
  'job applications': 'applications',
  connections: 'connections',
  profile: 'profile',
  positions: 'positions',
  education: 'education',
  skills: 'skills',
  certifications: 'certifications',
  'email addresses': 'emails',
};

/**
 * What a file in the archive is, from its name alone, or null for a file
 * Jobbotix has no use for and must not open. Folders ("Jobs/Saved Jobs.csv")
 * and part numbers ("Job Applications_2.csv") are allowed for.
 */
export function linkedInFileKind(path: string): LinkedInFileKind | null {
  const name = (path.split(/[\\/]/).pop() ?? '').trim();
  const m = /^(.*?)(?:[_ -]\d+)?\.csv$/i.exec(name);
  if (!m) return null;
  const key = m[1].toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return FILE_KINDS[key.trim()] ?? null;
}

/** A file of the archive, already decoded to text. */
export interface LinkedInExportFile {
  /** Its path inside the archive, or the name of a CSV picked by itself. */
  name: string;
  text: string;
}

/** A job the member saved or applied to on LinkedIn. */
export interface LinkedInJob {
  company: string;
  title: string;
  /** Always https://www.linkedin.com/jobs/view/<number>/ */
  url: string;
  status: 'shortlist' | 'applied';
  /** The day it was saved or applied to (YYYY-MM-DD), when the file says. */
  date: string | null;
}

/** A first-degree connection: who they are and where they work, no more. */
export interface LinkedInConnection {
  name: string;
  company: string;
  title: string;
  profileUrl: string;
  /** YYYY-MM-DD */
  connectedOn: string | null;
}

export interface LinkedInFileReport {
  name: string;
  kind: LinkedInFileKind;
  /** Rows taken from it. */
  rows: number;
  /** Rows left out, with why (first few only). */
  skipped: { row: number; reason: string }[];
  skippedCount: number;
  /** Set when the file could not be understood at all. */
  problem?: string;
}

export interface LinkedInExport {
  /** Saved jobs and applications as one list, an application winning a tie. */
  jobs: LinkedInJob[];
  connections: LinkedInConnection[];
  /** A resume built from the profile files, or null when there were none. */
  resume: ResumeSections | null;
  files: LinkedInFileReport[];
  /** Names handed in that are not files Jobbotix reads. */
  ignored: number;
}

/** No account has more first-degree connections than this. */
export const LINKEDIN_MAX_CONNECTIONS = 30_000;
export const LINKEDIN_MAX_JOBS = 5_000;

const norm = (s: string) =>
  s.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

const clean = (s: string | undefined, max: number) =>
  (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// --- Links -----------------------------------------------------------------

// The job-link helpers live with the other LinkedIn link rules, where the
// server reads them too.
export { linkedInJobId, linkedInJobUrl };

/** A member's profile link, tidied; '' when it is not a LinkedIn profile. */
function profileUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase();
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return '';
    if (!/^\/in\/[^/]+/.test(u.pathname)) return '';
    return `https://www.linkedin.com${u.pathname.replace(/\/+$/, '')}`.slice(
      0,
      500,
    );
  } catch {
    return '';
  }
}

// --- Dates -----------------------------------------------------------------

const MONTHS = [
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
];

const monthOf = (word: string) =>
  MONTHS.indexOf(word.slice(0, 3).toLowerCase());

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (y < 1950 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null; // 31 Feb and the like
  return date.toISOString().slice(0, 10);
}

/**
 * A day from the forms LinkedIn's archive uses: "17 Nov 2025",
 * "Nov 17, 2025", "11/17/25, 9:14 AM" (month first, as LinkedIn writes it),
 * "2025-11-17 09:14 UTC". A time of day is dropped. null when unreadable.
 */
export function parseLinkedInDay(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\D|$)/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})(?:\D|$)/.exec(s);
  if (m && monthOf(m[2]) >= 0) return iso(+m[3], monthOf(m[2]) + 1, +m[1]);
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:\D|$)/.exec(s);
  if (m && monthOf(m[1]) >= 0) return iso(+m[3], monthOf(m[1]) + 1, +m[2]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\D|$)/.exec(s);
  if (m) {
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    // month first; a "month" over 12 can only be the day
    return a > 12 ? iso(y, b, a) : iso(y, a, b);
  }
  return null;
}

/** "Jan 2020", "2020", "01/2020" -> "2020-01" or "2020"; '' when unreadable. */
export function parseLinkedInMonth(raw: string): string {
  const s = raw.trim();
  let m = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(s);
  if (m && monthOf(m[1]) >= 0)
    return `${m[2]}-${String(monthOf(m[1]) + 1).padStart(2, '0')}`;
  m = /^(\d{1,2})[/-](\d{4})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})(?:-(\d{1,2}))?$/.exec(s);
  if (m) return m[2] ? `${m[1]}-${m[2].padStart(2, '0')}` : m[1];
  const day = parseLinkedInDay(s);
  return day ? day.slice(0, 7) : '';
}

// --- Tables ----------------------------------------------------------------

/** For each field of a file kind, the column names LinkedIn has used. */
type Columns<F extends string> = Record<F, string[]>;

interface Table<F extends string> {
  /** One object per data row, by field; a missing column reads as ''. */
  rows: Record<F, string>[];
  /** 1-based line of the first data row, for "Row 12" messages. */
  firstRow: number;
}

/**
 * Finds the header (LinkedIn puts notes above it in some files) and reads the
 * rows under it. Only the named columns are ever looked at. null when no row
 * near the top carries at least `need` of the expected column names.
 */
function table<F extends string>(
  text: string,
  columns: Columns<F>,
  need: number,
): Table<F> | null {
  const all = parseCsv(text);
  const fields = Object.keys(columns) as F[];
  for (let h = 0; h < Math.min(all.length, 12); h++) {
    const header = all[h].map(norm);
    const index = {} as Record<F, number>;
    let found = 0;
    for (const f of fields) {
      index[f] = header.findIndex((c) => columns[f].includes(c));
      if (index[f] >= 0) found++;
    }
    if (found < need) continue;
    return {
      firstRow: h + 2,
      rows: all.slice(h + 1).map((r) => {
        const o = {} as Record<F, string>;
        for (const f of fields) o[f] = index[f] >= 0 ? (r[index[f]] ?? '') : '';
        return o;
      }),
    };
  }
  return null;
}

const NOT_UNDERSTOOD =
  'The columns were not the ones LinkedIn normally uses, so nothing was taken from this file.';

function report(name: string, kind: LinkedInFileKind): LinkedInFileReport {
  return { name, kind, rows: 0, skipped: [], skippedCount: 0 };
}

function skip(r: LinkedInFileReport, row: number, reason: string) {
  r.skippedCount++;
  if (r.skipped.length < 50) r.skipped.push({ row, reason });
}

// --- Jobs ------------------------------------------------------------------

const JOB_COLUMNS = {
  url: ['job url', 'url', 'job link', 'link'],
  title: ['job title', 'title', 'position'],
  company: ['company name', 'company'],
  // "Contact Email", "Contact Phone Number", "Resume Name" and "Question And
  // Answers" in Job Applications are deliberately not listed: never read.
  date: ['saved date', 'application date', 'applied on', 'date'],
};

function readJobs(
  file: LinkedInExportFile,
  status: LinkedInJob['status'],
  r: LinkedInFileReport,
): LinkedInJob[] {
  const t = table(file.text, JOB_COLUMNS, 3);
  if (!t) {
    r.problem = NOT_UNDERSTOOD;
    return [];
  }
  const out: LinkedInJob[] = [];
  t.rows.forEach((row, i) => {
    const line = t.firstRow + i;
    const url = linkedInJobUrl(row.url);
    const title = clean(row.title, 200);
    const company = clean(row.company, 200);
    if (!url) return skip(r, line, 'No link to a job on LinkedIn');
    if (!title || !company) return skip(r, line, 'No company or job title');
    out.push({ company, title, url, status, date: parseLinkedInDay(row.date) });
  });
  r.rows = out.length;
  return out;
}

// --- Connections -----------------------------------------------------------

const CONNECTION_COLUMNS = {
  first: ['first name'],
  last: ['last name'],
  url: ['url', 'profile url'],
  company: ['company'],
  title: ['position', 'title'],
  on: ['connected on'],
  // "Email Address" is deliberately not listed: a connection's email is
  // never read, whether or not they chose to show it.
};

function readConnections(
  file: LinkedInExportFile,
  r: LinkedInFileReport,
): LinkedInConnection[] {
  const t = table(file.text, CONNECTION_COLUMNS, 3);
  if (!t) {
    r.problem = NOT_UNDERSTOOD;
    return [];
  }
  const out: LinkedInConnection[] = [];
  t.rows.forEach((row, i) => {
    const name = clean(`${row.first} ${row.last}`, 120);
    // a member who closed their account, or hides their name
    if (!name) return skip(r, t.firstRow + i, 'No name');
    out.push({
      name,
      company: clean(row.company, 200),
      title: clean(row.title, 200),
      profileUrl: profileUrl(row.url),
      connectedOn: parseLinkedInDay(row.on),
    });
  });
  r.rows = out.length;
  return out;
}

// --- Resume ----------------------------------------------------------------

/** "[COMPANY:https://acme.example,PORTFOLIO:https://me.example]" -> links. */
function websites(raw: string): string[] {
  return (raw.match(/https?:\/\/[^\s,\]]+/gi) ?? []).map((u) =>
    u.replace(/[).;]+$/, ''),
  );
}

/** A position's description as bullets: one per line or bullet mark. */
function bullets(description: string): string[] {
  return description
    .split(/\r?\n|\s+[•·▪◦]\s+|\s{2,}-\s+/)
    .map((b) => b.replace(/^[\s•·▪◦*-]+/, '').trim())
    .filter((b) => b.length > 2)
    .slice(0, 12)
    .map((b) => b.slice(0, 400));
}

function readResume(
  files: Partial<Record<LinkedInFileKind, LinkedInExportFile[]>>,
  reports: Partial<Record<LinkedInFileKind, LinkedInFileReport[]>>,
): ResumeSections | null {
  const resume = emptyResume();
  let any = false;
  const each = <F extends string>(
    kind: LinkedInFileKind,
    columns: Columns<F>,
    need: number,
    take: (row: Record<F, string>) => boolean,
  ) => {
    (files[kind] ?? []).forEach((file, n) => {
      const r = reports[kind]?.[n];
      const t = table(file.text, columns, need);
      if (!t) {
        if (r) r.problem = NOT_UNDERSTOOD;
        return;
      }
      for (const row of t.rows)
        if (take(row)) {
          any = true;
          if (r) r.rows++;
        }
    });
  };

  each(
    'profile',
    {
      first: ['first name'],
      last: ['last name'],
      headline: ['headline'],
      summary: ['summary'],
      location: ['geo location', 'location'],
      websites: ['websites'],
    },
    2,
    (p) => {
      if (resume.contact.name) return false; // one profile per archive
      resume.contact.name = clean(`${p.first} ${p.last}`, 120);
      resume.contact.headline = clean(p.headline, 200);
      resume.contact.location = clean(p.location, 120);
      resume.summary = p.summary.trim().slice(0, 2000);
      const sites = websites(p.websites);
      resume.contact.website = sites[0] ?? '';
      resume.contact.links = sites
        .slice(1, 5)
        .map((url) => ({ label: 'Website', url }));
      return !!resume.contact.name;
    },
  );

  each(
    'emails',
    {
      email: ['email address', 'email'],
      primary: ['primary'],
    },
    1,
    (e) => {
      const email = clean(e.email, 320);
      if (!/^\S+@\S+\.\S+$/.test(email)) return false;
      // the member's own addresses: the primary one, else the first
      if (!resume.contact.email || /^(yes|true)$/i.test(e.primary.trim()))
        resume.contact.email = email;
      return true;
    },
  );

  each(
    'positions',
    {
      company: ['company name', 'company'],
      title: ['title', 'position'],
      description: ['description'],
      location: ['location'],
      start: ['started on', 'start date'],
      end: ['finished on', 'end date'],
    },
    2,
    (p) => {
      const entry: ExperienceEntry = {
        company: clean(p.company, 200),
        title: clean(p.title, 200),
        location: clean(p.location, 120),
        start: parseLinkedInMonth(p.start),
        end: parseLinkedInMonth(p.end),
        bullets: bullets(p.description),
      };
      if (!entry.company && !entry.title) return false;
      resume.experience.push(entry);
      return true;
    },
  );

  each(
    'education',
    {
      school: ['school name', 'school'],
      degree: ['degree name', 'degree'],
      end: ['end date', 'finished on'],
      start: ['start date', 'started on'],
    },
    1,
    (e) => {
      const entry: EducationEntry = {
        institution: clean(e.school, 200),
        degree: clean(e.degree, 200),
        year: parseLinkedInMonth(e.end || e.start).slice(0, 4),
      };
      if (!entry.institution) return false;
      resume.education.push(entry);
      return true;
    },
  );

  const skills: string[] = [];
  each('skills', { name: ['name', 'skill'] }, 1, (s) => {
    const name = clean(s.name, 60);
    if (!name || skills.includes(name) || skills.length >= 60) return false;
    skills.push(name);
    return true;
  });
  if (skills.length) resume.skills = [{ name: 'Skills', items: skills }];

  each(
    'certifications',
    { name: ['name'], authority: ['authority', 'issuer'] },
    1,
    (c) => {
      const name = clean(c.name, 160);
      if (!name || resume.certifications.length >= 30) return false;
      const by = clean(c.authority, 100);
      resume.certifications.push(by ? `${name} (${by})` : name);
      return true;
    },
  );

  // newest job first, as a resume reads; a job still held comes before all
  resume.experience.sort(
    (a, b) =>
      (b.end || '9999').localeCompare(a.end || '9999') ||
      b.start.localeCompare(a.start),
  );
  resume.experience = resume.experience.slice(0, 30);
  resume.education = resume.education.slice(0, 12);
  return any ? resume : null;
}

// --- The archive -----------------------------------------------------------

/**
 * Reads the files of a LinkedIn archive that Jobbotix uses. Files of any
 * other kind are counted and otherwise ignored; pass only what
 * `linkedInFileKind` accepts and nothing else is ever decoded at all.
 */
export function readLinkedInExport(
  files: LinkedInExportFile[],
): LinkedInExport {
  const byKind: Partial<Record<LinkedInFileKind, LinkedInExportFile[]>> = {};
  const reports: Partial<Record<LinkedInFileKind, LinkedInFileReport[]>> = {};
  const fileReports: LinkedInFileReport[] = [];
  let ignored = 0;
  for (const f of files) {
    const kind = linkedInFileKind(f.name);
    if (!kind) {
      ignored++;
      continue;
    }
    const r = report(f.name.split(/[\\/]/).pop() ?? f.name, kind);
    (byKind[kind] ??= []).push(f);
    (reports[kind] ??= []).push(r);
    fileReports.push(r);
  }

  // An application wins over a saved job with the same number; within a
  // file the first row wins.
  const jobs = new Map<string, LinkedInJob>();
  const titles = new Set<string>();
  const addJobs = (kind: 'applications' | 'savedJobs') =>
    (byKind[kind] ?? []).forEach((file, n) => {
      const r = reports[kind]?.[n];
      if (!r) return;
      const status = kind === 'applications' ? 'applied' : 'shortlist';
      let kept = 0;
      for (const job of readJobs(file, status, r)) {
        // Jobbotix keeps one job per company and title, as the pipeline does
        const pair = `${job.company}|${job.title}`.toLowerCase();
        if (jobs.has(job.url) || titles.has(pair)) {
          skip(r, 0, `Already listed: ${job.title} at ${job.company}`);
          continue;
        }
        if (jobs.size >= LINKEDIN_MAX_JOBS) {
          skip(r, 0, `Only the first ${LINKEDIN_MAX_JOBS} jobs are taken`);
          continue;
        }
        jobs.set(job.url, job);
        titles.add(pair);
        kept++;
      }
      r.rows = kept;
    });
  addJobs('applications');
  addJobs('savedJobs');

  const connections: LinkedInConnection[] = [];
  const seen = new Set<string>();
  (byKind.connections ?? []).forEach((file, n) => {
    const r = reports.connections?.[n];
    if (!r) return;
    let kept = 0;
    for (const c of readConnections(file, r)) {
      const key = (c.profileUrl || `${c.name}|${c.company}`).toLowerCase();
      if (seen.has(key)) continue;
      if (connections.length >= LINKEDIN_MAX_CONNECTIONS) {
        skip(r, 0, `Only the first ${LINKEDIN_MAX_CONNECTIONS} are taken`);
        continue;
      }
      seen.add(key);
      connections.push(c);
      kept++;
    }
    r.rows = kept;
  });

  return {
    jobs: [...jobs.values()],
    connections,
    resume: readResume(byKind, reports),
    files: fileReports,
    ignored,
  };
}
