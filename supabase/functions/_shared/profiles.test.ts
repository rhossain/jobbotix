import { deepStrictEqual as assertEquals } from 'node:assert';
import {
  nextProfileName,
  orderProfiles,
  searchedProfiles,
} from './profiles.ts';

const row = (id: string, active: boolean, created_at: string) => ({
  id,
  active,
  created_at,
});
const rows = [
  row('c', false, '2026-11-12T00:00:00Z'),
  row('a', false, '2026-11-10T00:00:00Z'),
  row('m', true, '2026-11-11T00:00:00Z'),
  row('b', false, '2026-11-10T00:00:00Z'),
];
const ids = (list: { id: string }[]) => list.map((r) => r.id).join('');

Deno.test('the main profile comes first, then the others oldest first', () => {
  assertEquals(ids(orderProfiles(rows)), 'mabc');
  assertEquals(ids(rows), 'camb'); // the input is left as it was
});

Deno.test(
  'no limit searches every profile; a limit keeps the first ones',
  () => {
    assertEquals(ids(searchedProfiles(rows, null)), 'mabc');
    assertEquals(ids(searchedProfiles(rows, 5)), 'mabc');
    assertEquals(ids(searchedProfiles(rows, 2)), 'ma');
    assertEquals(ids(searchedProfiles(rows, 1)), 'm');
  },
);

Deno.test('the main profile is searched even under a limit of 0', () => {
  assertEquals(ids(searchedProfiles(rows, 0)), 'm');
  assertEquals(searchedProfiles([], 1), []);
});

Deno.test('a new profile gets a name none of the others has', () => {
  assertEquals(nextProfileName(['Default']), 'Search 2');
  assertEquals(nextProfileName(['Default', 'search 3', 'x']), 'Search 4');
  assertEquals(nextProfileName(['Default', 'Search 2']), 'Search 3');
  assertEquals(nextProfileName(['A', 'Search 3']), 'Search 4');
});
