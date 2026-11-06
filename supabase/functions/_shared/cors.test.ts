import { deepStrictEqual as assertEquals } from 'node:assert';
import { withCors } from './cors.ts';

const handler = withCors((req) => {
  if (req.method === 'PUT') throw new Error('boom');
  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
});

Deno.test('preflight gets 204 with the CORS headers', async () => {
  const res = await handler(new Request('http://x/fn', { method: 'OPTIONS' }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('access-control-allow-origin'), '*');
  assertEquals(
    res.headers.get('access-control-allow-headers')?.includes('authorization'),
    true,
  );
});

Deno.test('normal responses keep status and headers, plus CORS', async () => {
  const res = await handler(new Request('http://x/fn', { method: 'POST' }));
  assertEquals(res.status, 201);
  assertEquals(res.headers.get('content-type'), 'application/json');
  assertEquals(res.headers.get('access-control-allow-origin'), '*');
  assertEquals(await res.json(), { ok: true });
});

Deno.test('a thrown error becomes a 500 the browser can read', async () => {
  const res = await handler(new Request('http://x/fn', { method: 'PUT' }));
  assertEquals(res.status, 500);
  assertEquals(res.headers.get('access-control-allow-origin'), '*');
  assertEquals(typeof (await res.json()).error, 'string');
});
