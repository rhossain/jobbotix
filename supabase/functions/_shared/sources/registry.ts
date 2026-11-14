// Every adapter Jobbotix can run, by source_catalog id. Adding a source means
// adding its module here and its row in source_catalog (a migration).

import { adzuna, jooble, reed } from './aggregators.ts';
import { ats } from './ats.ts';
import {
  arbeitnow,
  fourdayweek,
  getonboard,
  jobicy,
  remoteok,
  remotive,
  workingnomads,
} from './boards.ts';
import {
  hn,
  realworkfromanywhere,
  remotefirstjobs,
  weworkremotely,
} from './feeds.ts';
import { himalayas } from './himalayas.ts';
import type { SourceAdapter } from './types.ts';

export const ADAPTERS: Record<string, SourceAdapter> = Object.fromEntries(
  [
    himalayas,
    jobicy,
    remoteok,
    workingnomads,
    arbeitnow,
    remotive,
    weworkremotely,
    fourdayweek,
    getonboard,
    realworkfromanywhere,
    remotefirstjobs,
    hn,
    adzuna,
    jooble,
    reed,
    ats,
  ].map((a) => [a.id, a]),
);
