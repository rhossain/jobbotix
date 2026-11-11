import {
  countryName,
  toCountryCode,
  type RoleRow,
} from '@jobbotix/shared-types';
import { DEFAULT_TEMPLATE_ID, templateOf } from './resume-templates';

/**
 * Which resume template suits one job.
 *
 * Two things decide it. First where the employer hires: a photo on a resume
 * is expected in some countries and counts against the applicant in others,
 * so the Photo template is suggested only where it is customary, and never
 * when the job could be anywhere. Then the kind of employer and the length
 * of the resume pick among the others. When nothing stands out it is
 * Classic, the neutral choice that is right everywhere.
 *
 * These are conventions, not rules of any employer; the user decides.
 */

/** Countries where employers ask applicants not to send a photo. */
const PHOTO_DISCOURAGED = new Set(['US', 'CA', 'GB', 'IE', 'AU', 'NZ']);

/**
 * Countries where a photo on a resume is customary. Kept to the ones where
 * that is well established; everywhere else it is the applicant's choice
 * and the suggestion stays without one.
 */
const PHOTO_CUSTOMARY = new Set([
  // German-speaking Europe
  'DE',
  'AT',
  'CH',
  // the rest of continental Europe where it is usual
  'FR',
  'ES',
  'PT',
  'IT',
  'BE',
  'LU',
  'PL',
  'CZ',
  'SK',
  'HU',
  'RO',
  'GR',
  'TR',
  // the Gulf and Egypt
  'AE',
  'SA',
  'QA',
  'KW',
  'BH',
  'OM',
  'EG',
  // East, South-East and South Asia
  'CN',
  'JP',
  'KR',
  'VN',
  'TH',
  'ID',
  'MY',
  'PH',
  'BD',
  'PK',
  // Latin America
  'MX',
  'AR',
  'CL',
  'CO',
  'PE',
]);

export type PhotoNorm = 'customary' | 'discouraged' | 'open';

const TRADITIONAL =
  /\b(bank|banking|insurance|insurer|law firm|legal|attorney|government|ministry|public sector|university|audit|accounting|accountancy|pharma|pharmaceutical|hospital)\b/i;
const STARTUP =
  /\b(start-?up|seed[- ]stage|early[- ]stage|series [a-d]\b|scale-?up|founding (engineer|team))/i;
const CREATIVE = /\b(designer|creative|brand|art director|marketing)\b/i;

/** A resume past this many words runs over one page in most templates. */
const LONG_RESUME_WORDS = 650;

export interface TemplateSuggestion {
  /** The template to use for this job. */
  id: string;
  /** Why, in a sentence the user can agree or disagree with. */
  reason: string;
  photo: PhotoNorm;
  /** Where the job hires, in words ("Germany and Austria"); '' when unknown. */
  market: string;
  /** Something to do first, such as adding a photo; '' when nothing. */
  note: string;
}

type SuggestRole = Pick<
  RoleRow,
  | 'company'
  | 'title'
  | 'location'
  | 'hiring_countries'
  | 'remote_policy'
  | 'posting_text'
>;

/** The countries a role hires in: its list, else what its location names. */
export function roleCountries(role: SuggestRole): string[] {
  const listed = (role.hiring_countries ?? [])
    .map((c) => toCountryCode(c))
    .filter((c): c is string => !!c);
  if (listed.length) return [...new Set(listed)];
  if (role.remote_policy === 'worldwide') return [];
  // In free text only a country's name counts. A two-letter part is as
  // likely a US state: "Wilmington, DE" is Delaware, not Germany, and
  // reading it wrong would suggest a photo for an American job.
  const fromLocation = (role.location ?? '')
    .split(/[,/;|()]| - /)
    .map((part) => part.trim())
    .filter((part) => part.length > 2 || /^(UK|US)$/i.test(part))
    .map((part) => toCountryCode(part))
    .filter((c): c is string => !!c);
  return [...new Set(fromLocation)];
}

/** The photo convention across those countries; the stricter one wins. */
export function photoNorm(countries: string[]): PhotoNorm {
  if (!countries.length) return 'open';
  if (countries.some((c) => PHOTO_DISCOURAGED.has(c))) return 'discouraged';
  return countries.every((c) => PHOTO_CUSTOMARY.has(c)) ? 'customary' : 'open';
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length > 3) return `${names.slice(0, 3).join(', ')} and elsewhere`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function suggestTemplate(input: {
  role: SuggestRole;
  /** Words in the resume being sent. */
  words: number;
  /** The account has a resume photo. */
  hasPhoto: boolean;
  /** Whether the account's plan covers a template. */
  allowed?: (id: string) => boolean;
}): TemplateSuggestion {
  const { role, words, hasPhoto } = input;
  const allowed = input.allowed ?? (() => true);
  const countries = roleCountries(role);
  const photo = photoNorm(countries);
  const market = list(countries.map(countryName));
  const about = `${role.title} ${role.company} ${role.posting_text ?? ''}`;

  let id = DEFAULT_TEMPLATE_ID;
  let reason =
    'Clean and neutral: right for any employer, and the safe choice when nothing about the job says otherwise.';
  let note = '';

  if (photo === 'customary' && hasPhoto) {
    id = 'photo';
    reason = `A photo on a resume is customary in ${market}.`;
  } else if (TRADITIONAL.test(about)) {
    id = 'serif';
    reason = 'A traditional employer: a formal, restrained look fits.';
  } else if (words > LONG_RESUME_WORDS) {
    id = 'compact';
    reason = `Your resume runs to ${words} words; Compact keeps it to fewer pages.`;
  } else if (CREATIVE.test(role.title)) {
    id = 'banner';
    reason = 'A creative role: a stronger header helps you stand out.';
  } else if (STARTUP.test(about)) {
    id = 'modern';
    reason = 'A young product company: a modern look is the norm there.';
  }

  if (photo === 'customary' && !hasPhoto)
    note = `A photo is customary in ${market}. Add one on the Master resume page to use the Photo template.`;
  else if (photo === 'discouraged')
    note = `Employers in ${market} ask for resumes without a photo, so leave the Photo template for other jobs.`;
  else if (!countries.length)
    note =
      'This job could be anywhere, and a photo counts against you in some countries: send it without one.';

  if (!allowed(id)) {
    id = DEFAULT_TEMPLATE_ID;
    reason = `${templateOf(DEFAULT_TEMPLATE_ID).name} is the template on your plan, and it is right for any employer.`;
  }
  return { id, reason, photo, market, note };
}
