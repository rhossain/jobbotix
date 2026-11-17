import { deepStrictEqual as assertEquals } from 'node:assert';
import { MAX_REDIRECTS, noReadSite, openPage } from './open-page.ts';

/** A web in memory: address -> what it answers. Records every request. */
function web(
  pages: Record<string, { status?: number; location?: string; body?: string }>,
) {
  const asked: string[] = [];
  const fetchImpl = (url: string, init: RequestInit) => {
    asked.push(url);
    assertEquals(
      init.redirect,
      'manual',
      'redirects are never followed blindly',
    );
    const page = pages[url];
    if (!page) return Promise.reject(new Error('no such host'));
    return Promise.resolve(
      new Response(
        page.status && page.status >= 300 && page.status < 400
          ? null
          : (page.body ?? ''),
        {
          status: page.status ?? 200,
          headers: page.location ? { location: page.location } : {},
        },
      ),
    );
  };
  return { asked, fetchImpl };
}

Deno.test('LinkedIn and Upwork are the two sites that are never opened', () => {
  assertEquals(noReadSite('https://www.linkedin.com/jobs/view/1'), 'linkedin');
  assertEquals(noReadSite('https://lnkd.in/gAbCdEf'), 'linkedin');
  assertEquals(
    noReadSite('https://www.upwork.com/jobs/~01aaaaaaaaaaaaaaaa'),
    'upwork',
  );
  assertEquals(noReadSite('https://boards.greenhouse.io/acme/jobs/1'), null);
});

Deno.test('an ordinary page is fetched and its HTML returned', async () => {
  const w = web({
    'https://acme.example/jobs/1': { body: '<h1>Engineer</h1>' },
  });
  assertEquals(await openPage('https://acme.example/jobs/1', w.fetchImpl), {
    ok: true,
    html: '<h1>Engineer</h1>',
  });
  assertEquals(w.asked, ['https://acme.example/jobs/1']);
});

Deno.test('a LinkedIn link is refused without a single request', async () => {
  for (const url of [
    'https://www.linkedin.com/jobs/view/1',
    'https://lnkd.in/gAbCdEf',
  ]) {
    const w = web({ [url]: { body: 'never read' } });
    assertEquals(await openPage(url, w.fetchImpl), {
      ok: false,
      reason: 'no-read',
      site: 'linkedin',
    });
    assertEquals(w.asked, [], url);
  }
});

Deno.test(
  'a redirect onto LinkedIn or Upwork stops before the request',
  async () => {
    const w = web({
      'https://short.example/a': {
        status: 302,
        location: 'https://track.example/b',
      },
      'https://track.example/b': {
        status: 301,
        location: 'https://www.linkedin.com/jobs/view/1',
      },
      'https://www.linkedin.com/jobs/view/1': { body: 'never read' },
      'https://short.example/u': {
        status: 302,
        location: 'https://www.upwork.com/jobs/~01aaaaaaaaaaaaaaaa',
      },
      'https://www.upwork.com/jobs/~01aaaaaaaaaaaaaaaa': { body: 'never read' },
    });
    assertEquals(await openPage('https://short.example/a', w.fetchImpl), {
      ok: false,
      reason: 'no-read',
      site: 'linkedin',
    });
    assertEquals(await openPage('https://short.example/u', w.fetchImpl), {
      ok: false,
      reason: 'no-read',
      site: 'upwork',
    });
    // neither site was ever asked for a page
    assertEquals(w.asked, [
      'https://short.example/a',
      'https://track.example/b',
      'https://short.example/u',
    ]);
  },
);

Deno.test('other redirects are followed, relative ones included', async () => {
  const w = web({
    'https://acme.example/old': { status: 301, location: '/jobs/1' },
    'https://acme.example/jobs/1': { body: 'the post' },
  });
  assertEquals(await openPage('https://acme.example/old', w.fetchImpl), {
    ok: true,
    html: 'the post',
  });
  assertEquals(w.asked, [
    'https://acme.example/old',
    'https://acme.example/jobs/1',
  ]);
});

Deno.test(
  'an error status, a dead host and an endless redirect all fail quietly',
  async () => {
    const loop: Record<string, { status: number; location: string }> = {};
    for (let i = 0; i <= MAX_REDIRECTS + 1; i++)
      loop[`https://loop.example/${i}`] = {
        status: 302,
        location: `https://loop.example/${i + 1}`,
      };
    const w = web({
      'https://acme.example/gone': { status: 404 },
      'https://acme.example/nowhere': { status: 302 },
      'https://acme.example/odd': {
        status: 302,
        location: 'javascript:alert(1)',
      },
      ...loop,
    });
    assertEquals(await openPage('https://acme.example/gone', w.fetchImpl), {
      ok: false,
      reason: 'status',
      status: 404,
    });
    assertEquals(await openPage('https://acme.example/nowhere', w.fetchImpl), {
      ok: false,
      reason: 'status',
      status: 302,
    });
    assertEquals(await openPage('https://acme.example/odd', w.fetchImpl), {
      ok: false,
      reason: 'failed',
    });
    assertEquals(await openPage('https://dead.example/', w.fetchImpl), {
      ok: false,
      reason: 'failed',
    });
    assertEquals(await openPage('https://loop.example/0', w.fetchImpl), {
      ok: false,
      reason: 'failed',
    });
  },
);
