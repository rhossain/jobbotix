import { describe, expect, it } from 'vitest';
import { afterConfirm, readConfirmLink } from './confirm';

const params = (query: string) => new URLSearchParams(query);

describe('readConfirmLink', () => {
  it('reads the token and type from a sign-up link', () => {
    expect(readConfirmLink(params('token_hash=abc123&type=email'))).toEqual({
      tokenHash: 'abc123',
      type: 'email',
    });
  });

  it('rejects a link with no token', () => {
    expect(readConfirmLink(params('type=email'))).toBeNull();
    expect(readConfirmLink(params('token_hash=%20&type=email'))).toBeNull();
  });

  it('rejects a missing or unknown type', () => {
    expect(readConfirmLink(params('token_hash=abc123'))).toBeNull();
    expect(readConfirmLink(params('token_hash=abc123&type=sms'))).toBeNull();
  });
});

describe('afterConfirm', () => {
  it('sends a recovery link on to the new-password page', () => {
    expect(afterConfirm('recovery')).toBe('/reset-password');
  });

  it('sends every other link into the app', () => {
    expect(afterConfirm('email')).toBe('/');
    expect(afterConfirm('signup')).toBe('/');
    expect(afterConfirm('email_change')).toBe('/');
  });
});
