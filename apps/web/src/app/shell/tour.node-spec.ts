import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The tour names pages and `data-tour` anchors as strings. This keeps them
 * honest: every route must exist and every anchor must be in some template,
 * so renaming or removing one fails here instead of silently in the tour.
 */

const APP = new URL('..', import.meta.url).pathname; // apps/web/src/app/
const tour = readFileSync(join(APP, 'shell/tour.ts'), 'utf8');
const routes = readFileSync(join(APP, 'app.routes.ts'), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const templates = walk(APP)
  .filter((f) => /\.(ts|html)$/.test(f) && !/spec\.ts$/.test(f))
  .filter((f) => !f.endsWith('shell/tour.ts'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const stepsBlock = tour.slice(
  tour.indexOf('TOUR_STEPS'),
  tour.indexOf('];', tour.indexOf('TOUR_STEPS')),
);
const stepRoutes = [...stepsBlock.matchAll(/route: '([^']+)'/g)].map(
  (m) => m[1],
);
const targets = [...stepsBlock.matchAll(/target: '([^']+)'/g)].map((m) => m[1]);

describe('intro tour', () => {
  it('has steps', () => {
    expect(stepRoutes.length).toBeGreaterThan(5);
    expect(targets.length).toBeGreaterThan(5);
  });

  it('only visits routes that exist', () => {
    const paths = new Set(
      [...routes.matchAll(/path: '([^']*)'/g)].map((m) => '/' + m[1]),
    );
    expect(stepRoutes.filter((r) => !paths.has(r))).toEqual([]);
  });

  it('only points at anchors that exist', () => {
    expect(
      targets.filter((t) => !templates.includes(`data-tour="${t}"`)),
    ).toEqual([]);
  });
});
