// What a designation means, and whether a posting title is that job.
//
// A target role ("SQA Engineer", "Product Manager", "Head of Engineering")
// is read as words in a fixed spelling, with its level removed and its job
// word kept: "Engineering Manager" stays an engineering manager, never just
// "manager". A title then fits a role in one of four grades:
//
//   exact      the role's words stand together in the title
//   variant    the title is another name for the same job (role families)
//   partial    the same kind of job with the same speciality, worded apart
//   described  a plain "Software Engineer" title whose text names the speciality
//
// Nothing here is specific to one profession: a role no family lists still
// matches on its own words.

import { normaliseTitle } from './sources/normalise.ts';

export type Grade = 'exact' | 'variant' | 'partial' | 'described';
export const GRADE_RANK: Record<Grade, number> = {
  exact: 4,
  variant: 3,
  partial: 2,
  described: 1,
};

/** Spellings folded into one, longest first. Applied to roles and titles alike. */
const PHRASES: [RegExp, string][] = [
  [/\bsoftware (development )?engineers? in test\b/g, 'sdet'],
  [/\b(software )?quality assurance\b/g, 'qa'],
  [/\bsoftware qa\b|\bsqa\b|\bq a\b/g, 'qa'],
  [/\bsite reliability( engineer(ing)?)?\b/g, 'sre'],
  [/\bdev ops\b/g, 'devops'],
  [/\bnode js\b|\bnodejs\b/g, 'node'],
  [/\breact js\b|\breactjs\b/g, 'react'],
  [/\bvue js\b|\bvuejs\b/g, 'vue'],
  [/\bnext js\b/g, 'nextjs'],
  [/\bdot net\b|\basp net\b/g, 'net'],
  [/\bgolang\b/g, 'go'],
  [/\buser experience\b/g, 'ux'],
  [/\buser interface\b/g, 'ui'],
  [/\bui ux\b|\bux ui\b|\bui and ux\b|\bux and ui\b/g, 'ux'],
  [/\bmachine learning\b/g, 'ml'],
  [/\bartificial intelligence\b/g, 'ai'],
  [/\bbusiness intelligence\b/g, 'bi'],
  [/\bhuman resources?\b/g, 'hr'],
  [/\bvice president\b/g, 'vp'],
  [/\btechnical\b/g, 'tech'],
  [/\b(developers?|programmers?|coders?|devs?|swe|engineers)\b/g, 'engineer'],
  [/\badministrators?\b/g, 'admin'],
  [/\brepresentatives?\b|\breps\b/g, 'rep'],
  [/\bsystems\b/g, 'system'],
  [/\bsolutions\b/g, 'solution'],
  [/\baccounts\b/g, 'account'],
  [/\bmid level\b|\bmidlevel\b|\bentry level\b/g, ' '],
];

const LEVEL = new Set([
  'senior',
  'junior',
  'mid',
  'intermediate',
  'trainee',
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  '1',
  '2',
  '3',
]);

const STOP = new Set([
  'and',
  'or',
  'the',
  'of',
  'in',
  'a',
  'an',
  'for',
  'with',
  'at',
  'to',
  'on',
  'contract',
  'freelance',
  'full',
  'time',
  'part',
  'fulltime',
  'parttime',
  'leaning',
  'focused',
  'oriented',
  'heavy',
  'based',
  'm',
  'f',
  'd',
  'w',
  'x',
]);

/** Levels only when they open the title: "Staff Engineer", but "Chief of Staff", "Tech Lead", "Sales Associate". */
const LEADING_LEVEL = new Set(['lead', 'staff', 'principal', 'associate']);

/** Job words too broad to stand for a role on their own. */
const GENERIC_HEAD = new Set([
  'engineer',
  'manager',
  'lead',
  'director',
  'head',
  'vp',
  'specialist',
  'consultant',
  'analyst',
  'designer',
  'assistant',
  'coordinator',
  'executive',
  'officer',
  'admin',
  'rep',
  'intern',
  'expert',
  'architect',
  'associate',
  'agent',
  'advisor',
]);

/** Job words an engineering speciality can sit beside and still be that speciality. */
const TECH_HEAD = new Set([
  'architect',
  'lead',
  'manager',
  'consultant',
  'specialist',
  'expert',
  'analyst',
  'tester',
  'admin',
  'head',
  'director',
  'team',
]);

/** Words that say little about an engineering job ("Software Engineer", "Web Developer"). */
const WEAK = new Set([
  'software',
  'web',
  'application',
  'applications',
  'it',
  'tech',
  'system',
  'product',
  'solution',
]);

/**
 * Specialities that identify an engineering job on their own, wherever they
 * sit in a title: "Frontend Lead", "Architect (Angular)".
 */
const STRONG = new Set([
  'frontend',
  'backend',
  'fullstack',
  'devops',
  'sre',
  'qa',
  'mobile',
  'ios',
  'android',
  'angular',
  'angularjs',
  'react',
  'vue',
  'svelte',
  'nextjs',
  'nuxt',
  'node',
  'python',
  'django',
  'java',
  'kotlin',
  'swift',
  'flutter',
  'php',
  'laravel',
  'wordpress',
  'shopify',
  'ruby',
  'rails',
  'rust',
  'scala',
  'elixir',
  'c#',
  'c++',
  'typescript',
  'javascript',
  'salesforce',
  'sap',
  'unity',
  'unreal',
  'blockchain',
  'solidity',
  'embedded',
  'firmware',
]);

/**
 * A different discipline sitting right before the job word makes it another
 * job: a "Product Marketing Manager" is not a product manager.
 */
const DISCIPLINE = new Set([
  'marketing',
  'sales',
  'design',
  'support',
  'success',
  'account',
  'office',
  'project',
  'program',
  'product',
  'data',
  'security',
  'finance',
  'hr',
  'legal',
  'operations',
  'content',
  'community',
  'customer',
  'engineering',
  'qa',
  'hardware',
  'facilities',
  'people',
  'partner',
  'brand',
  'delivery',
  'service',
  'supply',
  'clinical',
  'compliance',
  'risk',
  'payroll',
  'recruiting',
  'talent',
  'event',
  'social',
  'media',
  'seo',
  'it',
  'research',
  'training',
  'quality',
  'business',
  'development',
]);

function canon(s: string): string {
  let t = ` ${normaliseTitle(s)} `;
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

/** "Head of Engineering" -> "Engineering Head"; "Engineer, Frontend" -> "Frontend Engineer". */
function reorder(raw: string): string {
  // "Web Developer (React)" -> "React Web Developer"
  let s = raw.replace(/^(.*?)\(([^)]+)\)(.*)$/, '$2 $1 $3');
  const comma = s.indexOf(',');
  if (comma > 0) s = `${s.slice(comma + 1)} ${s.slice(0, comma)}`;
  s = s.replace(
    /\b(head|director|vp|vice president|manager|lead)\s+of\s+([^,()|/-]+)/i,
    '$2 $1',
  );
  return s;
}

/** The words of a role or title in one spelling, without level or filler words. */
export function coreWords(raw: string): string[] {
  const words = canon(reorder(raw))
    .split(' ')
    .filter((w) => w && !STOP.has(w) && !LEVEL.has(w));
  while (words.length > 1 && LEADING_LEVEL.has(words[0])) words.shift();
  return words;
}

export interface ParsedRole {
  /** The role as typed. */
  role: string;
  words: string[];
  /** The job word ("engineer", "manager", "nurse"). */
  head: string;
  /** What kind ("frontend", "product"); empty for a bare "Developer". */
  specialities: string[];
  family: Family | null;
}

export function parseRole(role: string): ParsedRole | null {
  let words = coreWords(role);
  if (!words.length) return null;
  // "Angular", "Full Stack", "Frontend-leaning Full-stack": an engineer is meant
  if (words.every((w) => STRONG.has(w)) && !SOLO.has(words.join(' '))) {
    words = [...words, 'engineer'];
  }
  const head = words[words.length - 1];
  return {
    role,
    words,
    head,
    specialities: words.slice(0, -1),
    family: FAMILY_OF.get(words.join(' ')) ?? null,
  };
}

function containsRun(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** How well a posting title names this role; null when it is another job. */
export function titleFit(
  role: ParsedRole,
  title: string,
  support = '',
): Grade | null {
  const t = coreWords(title);
  if (!t.length) return null;
  const bare = role.words.length === 1 && GENERIC_HEAD.has(role.head);

  if (containsRun(t, role.words)) return bare ? 'partial' : 'exact';
  if (role.family) {
    if (role.family.same.some((p) => containsRun(t, p))) return 'variant';
    if (role.family.related.some((p) => containsRun(t, p))) return 'partial';
  }
  if (bare) return null;

  const has = (w: string) => t.includes(w);
  if (role.specialities.length && role.specialities.every(has)) {
    // same speciality and the same job word, with no other discipline in between
    if (has(role.head)) {
      const before = t[t.lastIndexOf(role.head) - 1];
      if (!before || role.words.includes(before) || !DISCIPLINE.has(before)) {
        return 'partial';
      }
    } // an engineering speciality names the job beside any technical job word:
    // "Frontend Lead", "Architect (Angular)"; not "Quality Assurance Nurse"
    else if (
      role.head === 'engineer' &&
      role.specialities.every((s) => STRONG.has(s)) &&
      t.every(
        (w) =>
          role.specialities.includes(w) ||
          STRONG.has(w) ||
          WEAK.has(w) ||
          TECH_HEAD.has(w),
      )
    ) {
      return 'partial';
    }
  }

  // "Software Engineer" whose text or tags name the speciality
  if (role.head === 'engineer' && support) {
    const strong = role.specialities.filter((s) => STRONG.has(s));
    const plain = t.filter((w) => !WEAK.has(w));
    if (
      strong.length &&
      strong.length === role.specialities.length &&
      plain.length === 1 &&
      plain[0] === 'engineer'
    ) {
      const text = ` ${canon(support)} `;
      if (strong.every((s) => text.includes(` ${s} `))) return 'described';
    }
  }
  return null;
}

export interface RoleFit {
  role: string;
  /** Position in the profile's target roles; 0 is the first choice. */
  index: number;
  grade: Grade;
}

/** The best fit among a profile's target roles; an earlier role wins a tie. */
export function bestRoleFit(
  targetRoles: string[],
  title: string,
  support = '',
): RoleFit | null {
  let best: RoleFit | null = null;
  targetRoles.forEach((r, index) => {
    const parsed = parseRole(r);
    if (!parsed) return;
    const grade = titleFit(parsed, title, support);
    if (grade && (!best || GRADE_RANK[grade] > GRADE_RANK[best.grade])) {
      best = { role: r, index, grade };
    }
  });
  return best;
}

/**
 * The term to search job boards with. A known family searches by its usual
 * short name ("qa", "frontend"); anything else by its own words.
 */
export function searchTerm(role: string): string | null {
  const p = parseRole(role);
  if (!p) return null;
  if (p.family) return p.family.search;
  if (p.head === 'engineer') {
    return p.specialities.length
      ? p.specialities.join(' ')
      : 'software engineer';
  }
  return p.words.join(' ');
}

/** Does any of these roles want this title? For sources that list every job a company has. */
export function anyRoleWants(roles: string[], title: string): boolean {
  return bestRoleFit(roles, title) !== null;
}

// ---------------------------------------------------------------------------
// Role families: other names for the same job, and close neighbours
// ---------------------------------------------------------------------------

export interface Family {
  id: string;
  search: string;
  same: string[][];
  related: string[][];
}

/** One-word roles that are complete as they are ("devops", "sre"). */
const SOLO = new Set(['devops', 'sre']);

const F = (
  id: string,
  search: string,
  same: string[],
  related: string[] = [],
): Family => ({
  id,
  search,
  same: same.map(coreWords).filter((w) => w.length),
  related: related.map(coreWords).filter((w) => w.length),
});

export const FAMILIES: Family[] = [
  F(
    'qa',
    'qa',
    [
      'QA Engineer',
      'QA Analyst',
      'QA Tester',
      'QA Specialist',
      'QA Automation Engineer',
      'Automation QA Engineer',
      'Software Tester',
      'Software Test Engineer',
      'Test Engineer',
      'Test Automation Engineer',
      'Automation Test Engineer',
      'Automation Tester',
      'Manual Tester',
      'SDET',
      'Quality Engineer',
    ],
    [
      'QA Lead',
      'QA Manager',
      'Test Lead',
      'Test Analyst',
      'Test Manager',
      'Game Tester',
    ],
  ),
  F(
    'frontend',
    'frontend',
    [
      'Frontend Engineer',
      'Frontend Web Engineer',
      'Frontend Software Engineer',
      'UI Engineer',
    ],
    [
      'Web Developer',
      'JavaScript Engineer',
      'TypeScript Engineer',
      'React Engineer',
      'Angular Engineer',
      'Vue Engineer',
      'UX Engineer',
      'Design Engineer',
    ],
  ),
  F(
    'backend',
    'backend',
    [
      'Backend Engineer',
      'Backend Software Engineer',
      'Server Side Engineer',
      'API Engineer',
    ],
    [
      'Node Engineer',
      'Python Engineer',
      'Java Engineer',
      'Go Engineer',
      'Ruby Engineer',
      'PHP Engineer',
      '.NET Engineer',
    ],
  ),
  F(
    'fullstack',
    'fullstack',
    [
      'Fullstack Engineer',
      'Fullstack Web Engineer',
      'Fullstack Software Engineer',
    ],
    ['Software Engineer', 'Web Developer', 'Product Engineer'],
  ),
  F(
    'software',
    'software engineer',
    [
      'Software Engineer',
      'Software Development Engineer',
      'Application Developer',
    ],
    [
      'Backend Engineer',
      'Frontend Engineer',
      'Fullstack Engineer',
      'Web Developer',
      'Product Engineer',
      'Platform Engineer',
      'Member of Technical Staff',
    ],
  ),
  F(
    'web',
    'web developer',
    ['Web Developer', 'Web Application Developer'],
    [
      'Frontend Engineer',
      'Fullstack Engineer',
      'WordPress Developer',
      'PHP Engineer',
      'JavaScript Engineer',
    ],
  ),
  F(
    'mobile',
    'mobile',
    ['Mobile Engineer', 'Mobile App Developer', 'Mobile Application Developer'],
    [
      'iOS Engineer',
      'Android Engineer',
      'React Native Engineer',
      'Flutter Engineer',
    ],
  ),
  F(
    'ios',
    'ios',
    ['iOS Engineer', 'iOS App Developer', 'Swift Engineer'],
    ['Mobile Engineer'],
  ),
  F(
    'android',
    'android',
    ['Android Engineer', 'Android App Developer', 'Kotlin Engineer'],
    ['Mobile Engineer'],
  ),
  F(
    'devops',
    'devops',
    [
      'DevOps Engineer',
      'DevOps',
      'SRE',
      'Platform Engineer',
      'Infrastructure Engineer',
      'Cloud Engineer',
      'DevSecOps Engineer',
    ],
    [
      'System Engineer',
      'Release Engineer',
      'Build Engineer',
      'Cloud Architect',
      'Kubernetes Engineer',
      'Reliability Engineer',
    ],
  ),
  F(
    'data-engineer',
    'data engineer',
    [
      'Data Engineer',
      'Analytics Engineer',
      'ETL Developer',
      'Data Platform Engineer',
    ],
    ['Data Architect', 'Database Engineer'],
  ),
  F(
    'data-analyst',
    'data analyst',
    ['Data Analyst', 'BI Analyst', 'Reporting Analyst', 'Analytics Analyst'],
    [
      'Product Analyst',
      'Insights Analyst',
      'BI Developer',
      'Analytics Specialist',
    ],
  ),
  F(
    'data-scientist',
    'data scientist',
    ['Data Scientist', 'Applied Scientist'],
    ['ML Engineer', 'Research Scientist', 'ML Scientist'],
  ),
  F(
    'ml',
    'machine learning',
    ['ML Engineer', 'AI Engineer', 'MLOps Engineer', 'AI ML Engineer'],
    [
      'Data Scientist',
      'Applied Scientist',
      'LLM Engineer',
      'Research Engineer',
    ],
  ),
  F(
    'security',
    'security engineer',
    [
      'Security Engineer',
      'Application Security Engineer',
      'Information Security Engineer',
      'Cybersecurity Engineer',
      'Security Analyst',
      'Cybersecurity Analyst',
    ],
    ['Penetration Tester', 'SOC Analyst', 'Security Architect'],
  ),
  F(
    'architect',
    'software architect',
    ['Software Architect', 'Solution Architect', 'Technical Architect'],
    ['Cloud Architect', 'Enterprise Architect'],
  ),
  F(
    'dba',
    'database administrator',
    ['Database Administrator', 'DBA'],
    ['Database Engineer', 'Data Engineer'],
  ),
  F(
    'sysadmin',
    'system administrator',
    [
      'System Administrator',
      'Sysadmin',
      'IT Administrator',
      'Network Administrator',
    ],
    [
      'IT Support Specialist',
      'IT Specialist',
      'Network Engineer',
      'System Engineer',
    ],
  ),
  F(
    'it-support',
    'it support',
    [
      'IT Support Specialist',
      'IT Support',
      'Help Desk Technician',
      'Helpdesk Technician',
      'IT Technician',
      'Desktop Support Technician',
      'Technical Support Specialist',
    ],
    ['System Administrator', 'Technical Support Engineer', 'Support Engineer'],
  ),
  F(
    'wordpress',
    'wordpress',
    ['WordPress Developer'],
    ['PHP Engineer', 'Web Developer', 'Shopify Developer'],
  ),
  F(
    'tech-lead',
    'tech lead',
    ['Tech Lead', 'Team Lead', 'Engineering Lead', 'Development Lead'],
    ['Engineering Manager', 'Software Architect'],
  ),
  F(
    'eng-manager',
    'engineering manager',
    ['Engineering Manager', 'Software Development Manager'],
    [
      'Head of Engineering',
      'Director of Engineering',
      'VP of Engineering',
      'Engineering Lead',
      'Tech Lead',
    ],
  ),
  F(
    'eng-head',
    'head of engineering',
    [
      'Head of Engineering',
      'Director of Engineering',
      'VP of Engineering',
      'CTO',
    ],
    ['Engineering Manager'],
  ),
  F(
    'product-manager',
    'product manager',
    ['Product Manager', 'Product Owner'],
    ['Product Lead', 'Head of Product', 'Director of Product'],
  ),
  F(
    'project-manager',
    'project manager',
    ['Project Manager', 'IT Project Manager'],
    [
      'Program Manager',
      'Delivery Manager',
      'Scrum Master',
      'Project Coordinator',
      'Project Lead',
    ],
  ),
  F(
    'business-analyst',
    'business analyst',
    ['Business Analyst', 'Business System Analyst', 'System Analyst'],
    ['Product Analyst', 'Functional Analyst', 'Requirements Analyst'],
  ),
  F(
    'ux',
    'ux designer',
    [
      'UX Designer',
      'UI Designer',
      'Product Designer',
      'Interaction Designer',
      'Experience Designer',
    ],
    [
      'Visual Designer',
      'Web Designer',
      'UX Researcher',
      'Digital Designer',
      'Design Lead',
    ],
  ),
  F(
    'graphic',
    'graphic designer',
    ['Graphic Designer', 'Visual Designer', 'Brand Designer'],
    [
      'Illustrator',
      'Motion Designer',
      'Creative Designer',
      'Marketing Designer',
    ],
  ),
  F(
    'video',
    'video editor',
    ['Video Editor'],
    ['Motion Designer', 'Videographer', 'Content Creator'],
  ),
  F(
    'digital-marketing',
    'digital marketing',
    [
      'Digital Marketing Manager',
      'Digital Marketing Specialist',
      'Digital Marketer',
      'Digital Marketing Executive',
      'Online Marketing Manager',
      'Performance Marketing Manager',
    ],
    [
      'Marketing Manager',
      'Growth Marketing Manager',
      'SEO Specialist',
      'Marketing Specialist',
      'PPC Specialist',
      'Social Media Manager',
    ],
  ),
  F(
    'marketing',
    'marketing manager',
    ['Marketing Manager', 'Marketing Lead'],
    [
      'Digital Marketing Manager',
      'Growth Marketing Manager',
      'Product Marketing Manager',
      'Head of Marketing',
      'Marketing Specialist',
    ],
  ),
  F(
    'seo',
    'seo',
    ['SEO Specialist', 'SEO Manager', 'SEO Analyst', 'SEO Expert'],
    ['Digital Marketing Specialist', 'Content Strategist'],
  ),
  F(
    'social',
    'social media',
    ['Social Media Manager', 'Social Media Specialist', 'Community Manager'],
    ['Content Creator', 'Digital Marketing Specialist'],
  ),
  F(
    'content',
    'content writer',
    ['Content Writer', 'Copywriter', 'Writer', 'Content Creator'],
    [
      'Content Strategist',
      'Content Editor',
      'Editor',
      'Technical Writer',
      'Content Specialist',
    ],
  ),
  F(
    'tech-writer',
    'technical writer',
    ['Technical Writer', 'Documentation Writer', 'Documentation Specialist'],
    ['Content Writer', 'Documentation Engineer'],
  ),
  F(
    'support',
    'customer support',
    [
      'Customer Support Specialist',
      'Customer Support',
      'Customer Support Representative',
      'Customer Support Agent',
      'Customer Support Associate',
      'Customer Service Representative',
      'Customer Service Agent',
      'Customer Service Specialist',
      'Customer Service',
      'Customer Care Specialist',
      'Support Specialist',
      'Support Agent',
    ],
    [
      'Technical Support Specialist',
      'Technical Support Engineer',
      'Customer Experience Specialist',
      'Support Engineer',
    ],
  ),
  F(
    'success',
    'customer success',
    [
      'Customer Success Manager',
      'Customer Success Specialist',
      'Client Success Manager',
    ],
    ['Account Manager', 'Customer Experience Manager'],
  ),
  F(
    'sales',
    'sales',
    [
      'Sales Executive',
      'Sales Representative',
      'Account Executive',
      'Sales Associate',
      'Business Development Representative',
      'Sales Development Representative',
      'BDR',
      'SDR',
      'Inside Sales Representative',
    ],
    [
      'Business Development Manager',
      'Sales Manager',
      'Account Manager',
      'Sales Specialist',
    ],
  ),
  F(
    'account-manager',
    'account manager',
    ['Account Manager', 'Client Manager'],
    ['Customer Success Manager', 'Account Executive'],
  ),
  F(
    'hr',
    'human resources',
    [
      'HR Manager',
      'HR Generalist',
      'HR Business Partner',
      'HR Specialist',
      'HR Officer',
      'HR Executive',
      'People Operations Manager',
      'People Partner',
    ],
    [
      'HR Coordinator',
      'HR Admin',
      'Talent Manager',
      'People Operations Specialist',
    ],
  ),
  F(
    'recruiter',
    'recruiter',
    [
      'Recruiter',
      'Talent Acquisition Specialist',
      'Talent Acquisition Partner',
      'Talent Acquisition Manager',
      'Sourcer',
    ],
    ['Recruiting Coordinator', 'HR Generalist'],
  ),
  F(
    'accountant',
    'accountant',
    [
      'Accountant',
      'Bookkeeper',
      'Accounting Specialist',
      'Accounting Associate',
    ],
    [
      'Account Payable Specialist',
      'Account Receivable Specialist',
      'Controller',
      'Finance Manager',
      'Financial Analyst',
      'Auditor',
      'Accounting Manager',
    ],
  ),
  F(
    'fin-analyst',
    'financial analyst',
    ['Financial Analyst', 'Finance Analyst', 'FP&A Analyst'],
    ['Accountant', 'Finance Manager'],
  ),
  F(
    'nurse',
    'nurse',
    ['Nurse', 'Registered Nurse', 'RN', 'Nurse Practitioner'],
    ['Clinical Reviewer', 'Case Manager'],
  ),
  F(
    'teacher',
    'teacher',
    ['Teacher', 'Tutor', 'Instructor', 'Educator'],
    ['Lecturer', 'Teaching Assistant'],
  ),
  F(
    'assistant',
    'virtual assistant',
    [
      'Virtual Assistant',
      'Executive Assistant',
      'Administrative Assistant',
      'Personal Assistant',
      'Admin Assistant',
    ],
    ['Office Manager', 'Operations Assistant', 'Office Admin'],
  ),
  F(
    'operations',
    'operations manager',
    ['Operations Manager', 'Business Operations Manager'],
    [
      'Operations Lead',
      'Operations Specialist',
      'Operations Coordinator',
      'Chief of Staff',
    ],
  ),
  F(
    'legal',
    'lawyer',
    ['Lawyer', 'Attorney', 'Legal Counsel', 'Counsel'],
    ['Paralegal', 'Legal Assistant'],
  ),
  F(
    'data-entry',
    'data entry',
    [
      'Data Entry Clerk',
      'Data Entry Specialist',
      'Data Entry Operator',
      'Data Entry',
    ],
    [],
  ),
  F(
    'translator',
    'translator',
    ['Translator', 'Interpreter', 'Localization Specialist'],
    [],
  ),
];

const FAMILY_OF = new Map<string, Family>();
for (const f of FAMILIES) {
  for (const p of f.same)
    if (!FAMILY_OF.has(p.join(' '))) FAMILY_OF.set(p.join(' '), f);
}
