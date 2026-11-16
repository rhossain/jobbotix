import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUIDES, guideLength } from './guides';

/** Every how-to guide on the Help page has its video and poster in public/help. */
const file = (name: string) =>
  new URL(`../../../../public/help/${name}`, import.meta.url);

describe('how-to guides', () => {
  it('has a video and a poster on disk for every guide', () => {
    for (const g of GUIDES) {
      expect(existsSync(file(`${g.id}.mp4`)), `${g.id}.mp4`).toBe(true);
      expect(existsSync(file(`${g.id}.jpg`)), `${g.id}.jpg`).toBe(true);
    }
  });

  it('keeps each video small enough to start quickly on a phone', () => {
    for (const g of GUIDES)
      expect(statSync(file(`${g.id}.mp4`)).size).toBeLessThan(3_000_000);
  });

  it('gives every guide written steps and a unique id', () => {
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
    for (const g of GUIDES) expect(g.steps.length).toBeGreaterThan(3);
  });

  it('rounds the running time to whole minutes', () => {
    expect(guideLength(46)).toBe('1 min');
    expect(guideLength(64)).toBe('1 min');
    expect(guideLength(130)).toBe('2 min');
  });
});
