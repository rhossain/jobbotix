import type { RoleRow, RoleStatus } from '@jobbotix/shared-types';

/**
 * CSV in and out: roles as a spreadsheet, and roles from a spreadsheet or
 * another tracker's export (Huntr, Teal, a Google Sheet). RFC 4180 quoting.
 */

/** The separator the header line uses most: comma, semicolon or tab. */
function separatorOf(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  return [',', ';', '\t']
    .map((sep) => [sep, first.split(sep).length] as const)
    .sort((x, y) => y[1] - x[1])[0][0];
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const sep = separatorOf(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    if (row.some((x) => x.trim())) rows.push(row);
    row = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else cell += c;
  }
  endRow();
  return rows;
}

const cellOut = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  // neutralise formulas when the file is opened in a spreadsheet
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(cellOut).join(',')).join('\r\n') + '\r\n';
}

export const ROLE_CSV_COLUMNS = [
  'company',
  'title',
  'url',
  'status',
  'score',
  'type',
  'location',
  'salary',
  'source',
  'posted_at',
  'found_at',
  'status_changed_at',
  'notes',
] as const;

export function rolesToCsv(roles: RoleRow[]): string {
  return toCsv([
    [...ROLE_CSV_COLUMNS],
    ...roles.map((r) => ROLE_CSV_COLUMNS.map((c) => r[c])),
  ]);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** One role read from someone's spreadsheet. */
export interface ImportedRole {
  company: string;
  title: string;
  url: string;
  status: RoleStatus;
  location: string;
  salary: string;
  notes: string;
}

export interface ImportPreview {
  roles: ImportedRole[];
  /** Row numbers (1-based, header = 1) skipped, with why. */
  skipped: { row: number; reason: string }[];
  /** Which column each field came from, for the preview. */
  columns: Partial<Record<keyof ImportedRole, string>>;
}

const ALIASES: Record<keyof ImportedRole, string[]> = {
  company: [
    'company',
    'company name',
    'employer',
    'organization',
    'organisation',
  ],
  title: ['title', 'job title', 'position', 'role', 'job', 'job position'],
  url: [
    'url',
    'link',
    'job url',
    'job link',
    'posting url',
    'posting',
    'job posting url',
    'application url',
  ],
  status: ['status', 'stage', 'state', 'column', 'list'],
  location: ['location', 'city', 'remote'],
  salary: ['salary', 'pay', 'compensation', 'salary range'],
  notes: ['notes', 'note', 'description', 'comments'],
};

const norm = (s: string) =>
  s.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** "Wishlist", "Applied", "Interviewing"… → a Jobbotix status. */
export function mapStatus(v: string): RoleStatus {
  const s = norm(v);
  if (!s) return 'new';
  if (/offer|accepted|hired/.test(s)) return 'offer';
  if (/reject|declin|not selected|closed|ghost/.test(s)) return 'rejected';
  if (/interview|screen|onsite|technical|final/.test(s)) return 'interview';
  if (/appl|submitted|sent/.test(s)) return 'applied';
  if (/wish|saved|bookmark|to apply|shortlist|interested|later/.test(s))
    return 'shortlist';
  if (/archiv|skip|withdr|not interested/.test(s)) return 'skipped';
  return 'new';
}

export function previewImport(text: string): ImportPreview {
  const rows = parseCsv(text);
  if (!rows.length) return { roles: [], skipped: [], columns: {} };
  const header = rows[0].map(norm);
  const columns: ImportPreview['columns'] = {};
  const index = {} as Record<keyof ImportedRole, number>;
  for (const field of Object.keys(ALIASES) as (keyof ImportedRole)[]) {
    const i = header.findIndex((h) => ALIASES[field].includes(h));
    index[field] = i;
    if (i >= 0) columns[field] = rows[0][i].trim();
  }
  const get = (r: string[], f: keyof ImportedRole) =>
    index[f] >= 0 ? (r[index[f]] ?? '').trim() : '';

  const roles: ImportedRole[] = [];
  const skipped: ImportPreview['skipped'] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const company = get(r, 'company');
    const title = get(r, 'title');
    let url = get(r, 'url');
    if (url && !/^https?:\/\//i.test(url) && /^[\w.-]+\.[a-z]{2,}\//i.test(url))
      url = `https://${url}`;
    if (!company || !title) {
      skipped.push({ row, reason: 'No company or title' });
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(url)) {
      skipped.push({ row, reason: 'No link to the posting' });
      return;
    }
    const key = url.toLowerCase();
    if (seen.has(key)) {
      skipped.push({ row, reason: 'Same link as an earlier row' });
      return;
    }
    seen.add(key);
    roles.push({
      company: company.slice(0, 200),
      title: title.slice(0, 200),
      url: url.slice(0, 1000),
      status: mapStatus(get(r, 'status')),
      location: get(r, 'location').slice(0, 300),
      salary: get(r, 'salary').slice(0, 100),
      notes: get(r, 'notes').slice(0, 5000),
    });
  });
  return { roles, skipped, columns };
}
