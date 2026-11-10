import { describe, expect, it } from 'vitest';
import { acceptPosting, bookmarklet, readShared } from './capture';

describe('readShared', () => {
  it('takes the url as given', () => {
    expect(
      readShared({ url: 'https://acme.example/jobs/1', title: 'Job' }),
    ).toEqual({ url: 'https://acme.example/jobs/1', text: '' });
  });

  it('finds the link inside shared text (Android)', () => {
    expect(
      readShared({
        text: 'Senior Angular Engineer at Acme https://acme.example/jobs/1).',
      }),
    ).toEqual({ url: 'https://acme.example/jobs/1', text: '' });
  });

  it('keeps long shared text as the posting', () => {
    const body = 'We are hiring. '.repeat(40);
    const r = readShared({ url: 'https://acme.example/jobs/1', text: body });
    expect(r.text.length).toBeGreaterThan(400);
  });

  it('gives an empty url when there is none', () => {
    expect(readShared({ text: 'just words' }).url).toBe('');
  });
});

describe('acceptPosting', () => {
  const msg = {
    type: 'jobbotix-posting',
    url: 'https://www.linkedin.com/jobs/view/1',
    title: 'Job',
    text: 'Posting',
  };

  it('accepts a posting from the page it describes', () => {
    expect(acceptPosting(msg, 'https://www.linkedin.com')).toMatchObject({
      url: msg.url,
      text: 'Posting',
    });
  });

  it('rejects other origins, other shapes and other schemes', () => {
    expect(acceptPosting(msg, 'https://evil.example')).toBeNull();
    expect(
      acceptPosting({ ...msg, type: 'x' }, 'https://www.linkedin.com'),
    ).toBeNull();
    expect(acceptPosting('hi', 'https://www.linkedin.com')).toBeNull();
    expect(
      acceptPosting({ ...msg, url: 'javascript:alert(1)' }, 'null'),
    ).toBeNull();
  });
});

describe('bookmarklet', () => {
  it('is a javascript: link aimed at the app', () => {
    const b = bookmarklet('https://app.jobbotix.com');
    expect(b.startsWith('javascript:')).toBe(true);
    const src = decodeURIComponent(b.slice('javascript:'.length));
    expect(src).toContain('"https://app.jobbotix.com"');
    expect(src).toContain('/roles/new?via=bookmarklet&url=');
    expect(() => new Function(src)).not.toThrow();
  });
});
