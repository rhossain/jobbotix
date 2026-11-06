// Every adapter Jobbotix can run, by source_catalog id. Adding a source means
// adding its module here and its row in source_catalog (a migration).

import { himalayas } from './himalayas.ts';
import type { SourceAdapter } from './types.ts';

export const ADAPTERS: Record<string, SourceAdapter> = {
  [himalayas.id]: himalayas,
};
