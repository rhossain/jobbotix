// One way to call Anthropic's Messages API, so model differences live here.
//
// Claude 5.x models think before answering by default, and that thinking
// counts against max_tokens. Jobbotix's calls ask for short, structured
// replies (a score, a letter, JSON), so callers pass the room the *reply*
// needs and messageParams turns that into what each model needs:
//   Haiku 5.x   thinking off
//   Sonnet 5.x  no up-front thinking ("between_tools")
//   Opus, Fable and anything newer that cannot switch thinking off:
//               low effort, with headroom for the thinking it still does
//   Claude 4.x and older: unchanged
// If a model rejects those settings, the call is retried once without them
// and with more room, so a new model never breaks a feature outright.

const API = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

type Line = 'haiku' | 'sonnet' | 'opus' | 'fable' | 'mythos' | '';

export function modelGeneration(model: string): { line: Line; major: number } {
  const m = model.match(/^claude-(haiku|sonnet|opus|fable|mythos)-(\d+)/);
  if (m) return { line: m[1] as Line, major: Number(m[2]) };
  // Older ids put the version first: claude-3-5-sonnet-...
  const old = model.match(/^claude-(\d+)(?:-\d+)?-(haiku|sonnet|opus)/);
  if (old) return { line: old[2] as Line, major: Number(old[1]) };
  return { line: '', major: 0 };
}

/** Body fields that give a reply of `replyTokens` room on `model`. */
export function messageParams(
  model: string,
  replyTokens: number,
): Record<string, unknown> {
  const { line, major } = modelGeneration(model);
  if (major < 5 && line) return { max_tokens: replyTokens };
  if (line === 'haiku')
    return { max_tokens: replyTokens, thinking: { type: 'disabled' } };
  if (line === 'sonnet')
    return {
      max_tokens: replyTokens + 2_000,
      thinking: { type: 'between_tools' },
    };
  return {
    max_tokens: replyTokens + 8_000,
    output_config: { effort: 'low' },
  };
}

/**
 * POST /v1/messages. `body.max_tokens` is the room the reply needs; the
 * per-model settings are added here. Returns the API's Response as is.
 */
export async function callMessages(
  apiKey: string,
  body: Record<string, unknown> & { model: string; max_tokens: number },
  timeoutMs: number,
): Promise<Response> {
  const send = (b: Record<string, unknown>) =>
    fetch(API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(timeoutMs),
    });
  const tuned = { ...body, ...messageParams(body.model, body.max_tokens) };
  const res = await send(tuned);
  if (res.status !== 400 || (!tuned['thinking'] && !tuned['output_config']))
    return res;
  const detail = await res
    .clone()
    .text()
    .catch(() => '');
  if (!/thinking|effort|output_config/i.test(detail)) return res;
  return send({ ...body, max_tokens: body.max_tokens + 16_000 });
}
