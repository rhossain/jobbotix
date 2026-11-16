/** A short, silent how-to video with the same steps written out beneath it. */
export type GuideId =
  | 'add-your-resume'
  | 'say-what-job-you-want'
  | 'connect-free-ai'
  | 'review-and-track-jobs';

export interface Guide {
  /** Also the file name under /help and the anchor on the Help page. */
  id: GuideId;
  title: string;
  lead: string;
  /** Running time in seconds. */
  seconds: number;
  steps: string[];
  /** Where the steps happen. */
  link: string;
  linkLabel: string;
  optional?: boolean;
}

export const GUIDES: Guide[] = [
  {
    id: 'add-your-resume',
    title: 'Add your resume',
    lead: 'Import the resume you already have. It takes about a minute.',
    seconds: 53,
    steps: [
      'On Today, press Add resume. You can also open Resume from the menu.',
      'Press Import my resume.',
      'Choose your PDF or Word file, or paste the text of your resume into the box.',
      'Press Read my resume.',
      'Check your name, jobs and skills, then press Replace my resume with this.',
      'Fix anything you like, then press Save version.',
      'The Resume check shows what to improve. You can download your resume as PDF or Word any time.',
    ],
    link: '/resume',
    linkLabel: 'Open Resume',
  },
  {
    id: 'say-what-job-you-want',
    title: 'Say what job you want',
    lead: 'Four short questions. Jobbotix searches for you from then on.',
    seconds: 61,
    steps: [
      'Open Job preferences from the menu.',
      'Press Fill from my resume. It fills in your job titles, skills and country for you.',
      'Question 1: check the job titles. Type another and press Enter to add it, or press × to remove one.',
      'Question 2: check your skills, one per line, your strongest first.',
      'Question 3: choose the country you live in. You can add other countries you can work for.',
      'Question 4: choose remote jobs only, or on-site and hybrid jobs too.',
      'More options holds pay, job type and emails. The usual choices are already set, so you can skip it.',
      'Press Save. Jobbotix checks new job posts against your choices every hour.',
    ],
    link: '/search',
    linkLabel: 'Open Job preferences',
  },
  {
    id: 'connect-free-ai',
    title: 'Connect free AI',
    lead: 'AI gives smarter match scores and writes better cover letters. Jobbotix works without it.',
    seconds: 46,
    optional: true,
    steps: [
      'Open Settings from the menu.',
      'Under AI connections, press Google Gemini. It is free to start and needs no card.',
      'Press Create a key. Google AI Studio opens in a new tab.',
      'In Google AI Studio, sign in with your Google account, create an API key, then copy it.',
      'Back in Jobbotix, tick the box, paste your key and press Check and save.',
      'When it says Working, you are done.',
    ],
    link: '/settings',
    linkLabel: 'Open Settings',
  },
  {
    id: 'review-and-track-jobs',
    title: 'Review and track jobs',
    lead: 'From a new job to an application you can follow.',
    seconds: 64,
    steps: [
      'New jobs are on Today, best match first. The ring is the match score out of 100.',
      'Press Save job to keep it, or Not for me to hide it. Both can be undone.',
      'Open a job to see why it fits and what to watch out for.',
      'A cover letter is drafted for strong matches. Press Edit to change it, or Rewrite for a new one.',
      'Press Open job post and apply on the employer’s own site. Jobbotix never applies for you.',
      'After you apply, set the status to Applied.',
      'Applications shows every job by stage. Drag a card across as things move.',
      'Today reminds you about interviews and follow-ups, so nothing is forgotten.',
    ],
    link: '/today',
    linkLabel: 'Open Today',
  },
];

/** "1 min" for anything up to 90 seconds; whole minutes after that. */
export function guideLength(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}
