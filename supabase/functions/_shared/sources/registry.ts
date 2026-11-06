// Every adapter Jobbotix can run, by source_catalog id. Adding a source means
// adding its module here and its row in source_catalog (a migration).

import { adzuna, jooble, reed } from './aggregators.ts';
import {
  arbeitnow,
  jobicy,
  remoteok,
  remotive,
  workingnomads,
} from './boards.ts';
import { hn, weworkremotely } from './feeds.ts';
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
    hn,
    adzuna,
    jooble,
    reed,
  ].map((a) => [a.id, a]),
);
