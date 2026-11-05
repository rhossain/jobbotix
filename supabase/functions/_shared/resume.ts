// Copy of libs/shared-types/src/lib/resume.ts for the Edge runtime; keep in step.
/**
 * The structured resume stored in resumes.sections (and resume_variants.sections).
 * Everything is plain data so a variant can diff against the master field by field.
 */
export interface ResumeContact {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  links: ResumeLink[];
}

export interface ResumeLink {
  label: string;
  url: string;
}

export interface SkillGroup {
  name: string;
  items: string[];
}

export interface ExperienceEntry {
  company: string;
  title: string;
  location: string;
  start: string; // "2019-03" or "2019"
  end: string; // "" = present
  bullets: string[];
}

export interface ProjectEntry {
  name: string;
  url: string;
  description: string;
  stack: string[];
}

export interface EducationEntry {
  institution: string;
  degree: string;
  year: string;
}

export interface ResumeSections {
  contact: ResumeContact;
  summary: string;
  skills: SkillGroup[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  aiToolkit: string[];
  education: EducationEntry[];
  certifications: string[];
}

export function emptyResume(): ResumeSections {
  return {
    contact: {
      name: '',
      headline: '',
      email: '',
      phone: '',
      location: '',
      website: '',
      links: [],
    },
    summary: '',
    skills: [],
    experience: [],
    projects: [],
    aiToolkit: [],
    education: [],
    certifications: [],
  };
}

/** Coerces whatever is in the JSON column into a complete ResumeSections. */
export function normaliseResume(value: unknown): ResumeSections {
  const base = emptyResume();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const v = value as Partial<ResumeSections>;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const strs = (x: unknown) =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
  const c = (v.contact ?? {}) as Partial<ResumeContact>;
  return {
    contact: {
      name: str(c.name),
      headline: str(c.headline),
      email: str(c.email),
      phone: str(c.phone),
      location: str(c.location),
      website: str(c.website),
      links: Array.isArray(c.links)
        ? c.links.map((l) => ({
            label: str((l as ResumeLink).label),
            url: str((l as ResumeLink).url),
          }))
        : [],
    },
    summary: str(v.summary),
    skills: Array.isArray(v.skills)
      ? v.skills.map((g) => ({
          name: str((g as SkillGroup).name),
          items: strs((g as SkillGroup).items),
        }))
      : [],
    experience: Array.isArray(v.experience)
      ? v.experience.map((e) => {
          const x = e as Partial<ExperienceEntry>;
          return {
            company: str(x.company),
            title: str(x.title),
            location: str(x.location),
            start: str(x.start),
            end: str(x.end),
            bullets: strs(x.bullets),
          };
        })
      : [],
    projects: Array.isArray(v.projects)
      ? v.projects.map((p) => {
          const x = p as Partial<ProjectEntry>;
          return {
            name: str(x.name),
            url: str(x.url),
            description: str(x.description),
            stack: strs(x.stack),
          };
        })
      : [],
    aiToolkit: strs(v.aiToolkit),
    education: Array.isArray(v.education)
      ? v.education.map((e) => {
          const x = e as Partial<EducationEntry>;
          return {
            institution: str(x.institution),
            degree: str(x.degree),
            year: str(x.year),
          };
        })
      : [],
    certifications: strs(v.certifications),
  };
}

/** Rough word count of everything a reader sees, for the one-page check. */
export function resumeWordCount(r: ResumeSections): number {
  const parts: string[] = [
    r.contact.name,
    r.contact.headline,
    r.summary,
    ...r.skills.flatMap((g) => [g.name, ...g.items]),
    ...r.experience.flatMap((e) => [e.company, e.title, ...e.bullets]),
    ...r.projects.flatMap((p) => [p.name, p.description, ...p.stack]),
    ...r.aiToolkit,
    ...r.education.flatMap((e) => [e.institution, e.degree]),
    ...r.certifications,
  ];
  return parts.join(' ').split(/\s+/).filter(Boolean).length;
}

/** "2019-03" -> "Mar 2019"; "" -> "Present"; anything else passes through. */
export function formatResumeDate(value: string): string {
  if (!value) return 'Present';
  const m = value.match(/^(\d{4})-(\d{2})$/);
  if (!m) return value;
  const month =
    [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ][Number(m[2]) - 1] ?? '';
  return `${month} ${m[1]}`.trim();
}
