// CORS for the functions the web app calls from the browser (supabase-js
// `functions.invoke`). The browser sends an OPTIONS preflight first; without
// a 2xx answer carrying these headers it never sends the real request, and
// supabase-js reports "Failed to send a request to the Edge Function".
//
// Any origin is allowed: these functions authenticate with the bearer JWT in
// the Authorization header, never with cookies, so the origin grants nothing.

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type',
  'access-control-max-age': '86400',
};

type Handler = (req: Request) => Response | Promise<Response>;

/** Answers preflights and adds the CORS headers to every response, errors included. */
export function withCors(handler: Handler): Handler {
  return async (req) => {
    if (req.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    let res: Response;
    try {
      res = await handler(req);
    } catch (e) {
      console.error(e);
      res = new Response(
        JSON.stringify({
          error: 'Something went wrong on the server. Try again.',
        }),
        {
          status: 500,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        },
      );
    }
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}
