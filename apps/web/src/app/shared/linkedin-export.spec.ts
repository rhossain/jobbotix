import { describe, expect, it } from 'vitest';
import {
  linkedInFileKind,
  linkedInJobId,
  linkedInJobUrl,
  parseLinkedInDay,
  parseLinkedInMonth,
  readLinkedInExport,
} from './linkedin-export';

// Made-up files in the shape of LinkedIn's archive. No real person is in them.
const SAVED = `Saved Date,Job Url,Job Title,Company Name
"11/14/26, 9:14 AM",http://www.linkedin.com/jobs/view/4012345678,Senior Angular Engineer,Acme
"11/10/26, 6:02 PM",https://www.linkedin.com/jobs/view/4099999999/,Frontend Lead,"Globex, Inc."
"11/09/26, 1:00 PM",https://example.org/not-linkedin,Engineer,Initech
"11/08/26, 1:00 PM",https://www.linkedin.com/jobs/view/4011111111,,Hooli
`;

const APPLIED = `Application Date,Contact Email,Contact Phone Number,Company Name,Job Title,Job Url,Resume Name,Question And Answers
"11/12/26, 10:30 AM",recruiter@globex.example,+1 555 0100,"Globex, Inc.",Frontend Lead,http://www.linkedin.com/jobs/view/4099999999,resume-final.pdf,"Years of Angular?:9 | Salary expectation?:secret"
"10/30/26, 8:00 AM",,,Umbrella,Staff Frontend Engineer,https://www.linkedin.com/jobs/view/4022222222,resume-final.pdf,
`;

const CONNECTIONS = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who allowed their connections to see or download their email addresses."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Dana,Whitfield,https://www.linkedin.com/in/dana-whitfield-example,dana@private.example,Acme,Engineering Manager,17 Nov 2025
Ravi,Menon,https://www.linkedin.com/in/ravi-menon-example/,,"Globex, Inc.",Senior Recruiter,03 Jan 2024
Ravi,Menon,https://www.linkedin.com/in/ravi-menon-example,,"Globex, Inc.",Senior Recruiter,03 Jan 2024
,,,,,,02 Feb 2020
`;

const PROFILE = `First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers
Alex,Morgan,,12 Private Road,Jan 1,Senior Frontend Engineer,"Frontend engineer with 12 years of experience.",Software,1207,"Dhaka, Bangladesh",,[PORTFOLIO:https://alex.example],
`;

const POSITIONS = `Company Name,Title,Description,Location,Started On,Finished On
Northwind,Senior Frontend Engineer,"Rebuilt the reporting dashboard in Angular.
Led 4 engineers on the design-system migration.",Remote,Mar 2021,
Contoso,Frontend Engineer,Built the checkout.,Dhaka,Jun 2016,Feb 2021
`;

const EDUCATION = `School Name,Start Date,End Date,Notes,Degree Name,Activities
Example University,2008,2012,,BSc in Computer Science,
`;

const SKILLS = `Name
Angular
TypeScript
Angular
`;

const EMAILS = `Email Address,Confirmed,Primary,Updated On
old@alex.example,Yes,No,1/1/20
alex@alex.example,Yes,Yes,1/1/24
`;

describe('linkedInFileKind', () => {
  it('names the files Jobbotix reads, in a folder or split into parts', () => {
    expect(linkedInFileKind('Saved Jobs.csv')).toBe('savedJobs');
    expect(linkedInFileKind('Jobs/Job Applications.csv')).toBe('applications');
    expect(linkedInFileKind('Jobs/Job Applications_2.csv')).toBe(
      'applications',
    );
    expect(linkedInFileKind('Basic_LinkedInDataExport/Connections.csv')).toBe(
      'connections',
    );
    expect(linkedInFileKind('PROFILE.CSV')).toBe('profile');
    expect(linkedInFileKind('Email Addresses.csv')).toBe('emails');
  });

  it('gives null for everything else, so it is never opened', () => {
    for (const name of [
      'messages.csv',
      'Invitations.csv',
      'Contacts.csv',
      'SearchQueries.csv',
      'Jobs/Job Applicant Saved Answers.csv',
      'Jobs/Job Seeker Preferences.csv',
      'Profile Summary.csv',
      'Connections.csv.bak',
      'Rich_Media.csv',
      'connections.txt',
    ])
      expect(linkedInFileKind(name), name).toBeNull();
  });
});

describe('LinkedIn job links', () => {
  it('reads the job number from every form of link', () => {
    for (const url of [
      'http://www.linkedin.com/jobs/view/4012345678',
      'https://www.linkedin.com/jobs/view/4012345678/?trk=eml&refId=abc',
      'https://bd.linkedin.com/jobs/view/senior-angular-engineer-at-acme-4012345678',
      'https://www.linkedin.com/comm/jobs/view/4012345678',
      'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678',
    ])
      expect(linkedInJobId(url), url).toBe('4012345678');
    expect(linkedInJobUrl('http://www.linkedin.com/jobs/view/4012345678')).toBe(
      'https://www.linkedin.com/jobs/view/4012345678/',
    );
  });

  it('refuses links that are not a LinkedIn job', () => {
    for (const url of [
      'https://example.org/jobs/view/4012345678',
      'https://www.linkedin.com/in/someone',
      'https://www.linkedin.com/jobs/search/?keywords=angular',
      'https://lnkd.in/gAbCdEf',
      'not a link',
      '',
    ])
      expect(linkedInJobUrl(url), url).toBeNull();
  });
});

describe('LinkedIn dates', () => {
  it('reads the day in each form the archive uses', () => {
    expect(parseLinkedInDay('17 Nov 2025')).toBe('2025-11-17');
    expect(parseLinkedInDay('Nov 17, 2025')).toBe('2025-11-17');
    expect(parseLinkedInDay('11/14/26, 9:14 AM')).toBe('2026-11-14');
    expect(parseLinkedInDay('1/2/2024')).toBe('2024-01-02');
    expect(parseLinkedInDay('25/12/2024')).toBe('2024-12-25');
    expect(parseLinkedInDay('2026-11-14 09:14 UTC')).toBe('2026-11-14');
  });

  it('gives null for anything it cannot read', () => {
    for (const s of ['', 'yesterday', '31 Feb 2024', '13/13/24', '2026'])
      expect(parseLinkedInDay(s), s).toBeNull();
  });

  it('reads months for a resume', () => {
    expect(parseLinkedInMonth('Mar 2021')).toBe('2021-03');
    expect(parseLinkedInMonth('2012')).toBe('2012');
    expect(parseLinkedInMonth('06/2016')).toBe('2016-06');
    expect(parseLinkedInMonth('')).toBe('');
  });
});

describe('readLinkedInExport', () => {
  const all = readLinkedInExport([
    { name: 'Jobs/Saved Jobs.csv', text: SAVED },
    { name: 'Jobs/Job Applications.csv', text: APPLIED },
    { name: 'Connections.csv', text: CONNECTIONS },
    { name: 'Profile.csv', text: PROFILE },
    { name: 'Positions.csv', text: POSITIONS },
    { name: 'Education.csv', text: EDUCATION },
    { name: 'Skills.csv', text: SKILLS },
    { name: 'Email Addresses.csv', text: EMAILS },
    { name: 'messages.csv', text: 'FROM,TO,CONTENT\na,b,secret' },
  ]);

  it('turns saved jobs and applications into one list of jobs', () => {
    expect(all.jobs).toEqual([
      {
        company: 'Globex, Inc.',
        title: 'Frontend Lead',
        url: 'https://www.linkedin.com/jobs/view/4099999999/',
        status: 'applied',
        date: '2026-11-12',
      },
      {
        company: 'Umbrella',
        title: 'Staff Frontend Engineer',
        url: 'https://www.linkedin.com/jobs/view/4022222222/',
        status: 'applied',
        date: '2026-10-30',
      },
      {
        company: 'Acme',
        title: 'Senior Angular Engineer',
        url: 'https://www.linkedin.com/jobs/view/4012345678/',
        status: 'shortlist',
        date: '2026-11-14',
      },
    ]);
  });

  it('says which rows it left out and why', () => {
    const saved = all.files.find((f) => f.kind === 'savedJobs');
    expect(saved?.rows).toBe(1);
    expect(saved?.skippedCount).toBe(3);
    expect(saved?.skipped.map((s) => s.reason)).toEqual([
      'No link to a job on LinkedIn',
      'No company or job title',
      'Already listed: Frontend Lead at Globex, Inc.',
    ]);
  });

  it('keeps who a connection is and where they work, and nothing else', () => {
    expect(all.connections).toEqual([
      {
        name: 'Dana Whitfield',
        company: 'Acme',
        title: 'Engineering Manager',
        profileUrl: 'https://www.linkedin.com/in/dana-whitfield-example',
        connectedOn: '2025-11-17',
      },
      {
        name: 'Ravi Menon',
        company: 'Globex, Inc.',
        title: 'Senior Recruiter',
        profileUrl: 'https://www.linkedin.com/in/ravi-menon-example',
        connectedOn: '2024-01-03',
      },
    ]);
  });

  it('never carries anyone else’s contact details or answers', () => {
    const everything = JSON.stringify(all);
    for (const secret of [
      'dana@private.example',
      'recruiter@globex.example',
      '555 0100',
      'Salary expectation',
      'resume-final.pdf',
      '12 Private Road',
      'Jan 1',
      'secret',
    ])
      expect(everything, secret).not.toContain(secret);
    expect(all.ignored).toBe(1);
  });

  it('builds a resume from the profile files', () => {
    expect(all.resume?.contact).toMatchObject({
      name: 'Alex Morgan',
      headline: 'Senior Frontend Engineer',
      location: 'Dhaka, Bangladesh',
      email: 'alex@alex.example',
      website: 'https://alex.example',
    });
    expect(all.resume?.summary).toBe(
      'Frontend engineer with 12 years of experience.',
    );
    expect(all.resume?.experience).toEqual([
      {
        company: 'Northwind',
        title: 'Senior Frontend Engineer',
        location: 'Remote',
        start: '2021-03',
        end: '',
        bullets: [
          'Rebuilt the reporting dashboard in Angular.',
          'Led 4 engineers on the design-system migration.',
        ],
      },
      {
        company: 'Contoso',
        title: 'Frontend Engineer',
        location: 'Dhaka',
        start: '2016-06',
        end: '2021-02',
        bullets: ['Built the checkout.'],
      },
    ]);
    expect(all.resume?.education).toEqual([
      {
        institution: 'Example University',
        degree: 'BSc in Computer Science',
        year: '2012',
      },
    ]);
    expect(all.resume?.skills).toEqual([
      { name: 'Skills', items: ['Angular', 'TypeScript'] },
    ]);
  });

  it('gives no resume when there are no profile files', () => {
    const r = readLinkedInExport([{ name: 'Saved Jobs.csv', text: SAVED }]);
    expect(r.resume).toBeNull();
    expect(r.connections).toEqual([]);
    expect(r.jobs.map((j) => j.status)).toEqual(['shortlist', 'shortlist']);
  });

  it('reports a file whose columns it does not know instead of guessing', () => {
    const r = readLinkedInExport([
      { name: 'Connections.csv', text: 'A,B,C\n1,2,3\n' },
      { name: 'Saved Jobs.csv', text: 'Whatever\nrow\n' },
    ]);
    expect(r.connections).toEqual([]);
    expect(r.jobs).toEqual([]);
    expect(r.files.every((f) => !!f.problem)).toBe(true);
  });
});
