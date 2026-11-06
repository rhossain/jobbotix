import { deepStrictEqual as assertEquals } from 'node:assert';
import {
  parseLocations,
  regionIncludes,
  toCountryCode,
  toRegion,
} from './countries.ts';

Deno.test('toCountryCode reads names, codes and board spellings', () => {
  assertEquals(toCountryCode('Bangladesh'), 'BD');
  assertEquals(toCountryCode('bd'), 'BD');
  assertEquals(toCountryCode('United States of America'), 'US');
  assertEquals(toCountryCode('USA'), 'US');
  assertEquals(toCountryCode('UK'), 'GB');
  assertEquals(toCountryCode('Germany'), 'DE');
  assertEquals(toCountryCode('Hong Kong'), 'HK');
  assertEquals(toCountryCode('Türkiye'), 'TR');
  assertEquals(toCountryCode('Côte d’Ivoire'), 'CI');
  assertEquals(toCountryCode('Mars'), null);
  assertEquals(toCountryCode('EU'), null);
});

Deno.test('regions hold the countries a board means by them', () => {
  assertEquals(toRegion('EMEA'), 'emea');
  assertEquals(toRegion('Europe only'), 'europe');
  assertEquals(toRegion('Germany'), null);
  assertEquals(regionIncludes('APAC', 'BD'), true);
  assertEquals(regionIncludes('Asia', 'AE'), true);
  assertEquals(regionIncludes('Europe', 'BD'), false);
  assertEquals(regionIncludes('LATAM', 'BR'), true);
  assertEquals(regionIncludes('LATAM', 'US'), false);
});

Deno.test('parseLocations splits a board location list', () => {
  assertEquals(parseLocations(['Worldwide']), {
    worldwide: true,
    countries: [],
    regions: [],
    unknown: [],
  });
  assertEquals(
    parseLocations(['US / Canada', 'Europe', 'Remote - Poland', 'Gotham']),
    {
      worldwide: false,
      countries: ['US', 'CA', 'PL'],
      regions: ['europe'],
      unknown: ['Gotham'],
    },
  );
  assertEquals(parseLocations(['United Kingdom (UK)', 'Germany']).countries, [
    'GB',
    'DE',
  ]);
});

Deno.test(
  'ISO-style and saint spellings resolve; whole items are not split',
  () => {
    assertEquals(toCountryCode('Saint Vincent and the Grenadines'), 'VC');
    assertEquals(toCountryCode('St. Kitts & Nevis'), 'KN');
    assertEquals(toCountryCode('Korea, Republic of'), 'KR');
    assertEquals(toCountryCode('Iran, Islamic Republic of'), 'IR');
    assertEquals(
      parseLocations([
        'Congo, The Democratic Republic of the',
        'Congo',
        'Bahamas',
      ]).countries,
      ['CD', 'CG', 'BS'],
    );
    assertEquals(parseLocations(['US, Canada']).countries, ['US', 'CA']);
  },
);
