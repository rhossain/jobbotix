import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import {
  readSupportInput,
  supportEmail,
  supportSubject,
  SUPPORT_MAX_MESSAGE,
} from './support.ts';

Deno.test('readSupportInput keeps a usable request and cuts it to size', () => {
  const r = readSupportInput({
    message: '  How do I export?  ',
    page: '/settings/data',
    conversation: 'Asked: export',
  });
  assertEquals(r, {
    message: 'How do I export?',
    page: '/settings/data',
    conversation: 'Asked: export',
  });
  const long = readSupportInput({ message: 'x'.repeat(5000) });
  assertEquals(long?.message.length, SUPPORT_MAX_MESSAGE);
});

Deno.test('readSupportInput refuses an empty question and odd pages', () => {
  assertEquals(readSupportInput({ message: '   ' }), null);
  assertEquals(readSupportInput(null), null);
  assertEquals(
    readSupportInput({ message: 'hi', page: 'https://evil.example/x' })?.page,
    '',
  );
  assertEquals(readSupportInput({ message: 'hi', page: 42 })?.page, '');
});

Deno.test('supportSubject is one short line', () => {
  assertEquals(supportSubject('Where\nis it?'), 'Help request: Where is it?');
  const s = supportSubject('a'.repeat(200));
  assert(s.length <= 'Help request: '.length + 68);
  assert(s.endsWith('…'));
});

Deno.test('supportEmail escapes what the person typed', () => {
  const e = supportEmail(
    {
      message: '<script>alert(1)</script>',
      page: '/jobs',
      conversation: 'Asked: <b>x</b>',
    },
    { email: 'a@b.c', name: 'Ann', plan: 'Free', userId: 'u1' },
    'https://jobbotix.com',
  );
  assert(!e.html.includes('<script>'));
  assert(e.html.includes('&lt;script&gt;'));
  assert(!e.html.includes('<b>x</b>'));
  assert(e.text.includes('Page: https://jobbotix.com/jobs'));
  assert(e.text.includes('From: Ann <a@b.c>'));
});
