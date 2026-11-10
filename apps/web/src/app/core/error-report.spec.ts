import { describe, expect, it } from 'vitest';
import { isNoise, normalisePath, toReport } from './error-report';

describe('normalisePath', () => {
  it('folds ids so one bug on many roles is one group', () => {
    expect(
      normalisePath('/roles/2f0c6a1e-1b2c-4d5e-8f90-123456789abc?tab=prep'),
    ).toBe('/roles/:id');
    expect(normalisePath('/admin/42/x')).toBe('/admin/:n/x');
  });
});

describe('toReport', () => {
  it('groups the same error with different numbers', () => {
    const a = toReport(
      new TypeError('Cannot read 3 of undefined'),
      '/today',
      'UA',
    );
    const b = toReport(
      new TypeError('Cannot read 7 of undefined'),
      '/today',
      'UA',
    );
    expect(a?.fingerprint).toBe(b?.fingerprint);
    expect(a?.fingerprint).toBe(
      'TypeError: Cannot read # of undefined @ /today',
    );
    expect(a?.message).toBe('Cannot read 3 of undefined');
  });

  it('unwraps promise rejections and plain values', () => {
    expect(
      toReport({ rejection: new RangeError('bad') }, '/x', 'UA')?.name,
    ).toBe('RangeError');
    expect(toReport('oops', '/x', 'UA')?.message).toBe('oops');
    expect(toReport({ code: 1 }, '/x', 'UA')?.message).toBe('{"code":1}');
  });

  it('drops browser noise', () => {
    expect(
      toReport(new Error('ResizeObserver loop limit exceeded'), '/', ''),
    ).toBeNull();
    expect(isNoise('Error', 'x', 'at chrome-extension://abc/x.js')).toBe(true);
    expect(isNoise('AbortError', 'aborted', '')).toBe(true);
  });
});
