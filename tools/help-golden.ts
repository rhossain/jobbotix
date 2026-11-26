// The Help chat's 40 test questions against a real model, from a terminal:
// 30 it must answer from the right article, 10 it must decline
// (supabase/functions/_shared/help-questions.ts).
//
//   ANTHROPIC_API_KEY=... deno run --allow-net --allow-env --allow-read tools/help-golden.ts anthropic
//   GEMINI_API_KEY=...    deno run --allow-net --allow-env --allow-read tools/help-golden.ts gemini
//   GROQ_API_KEY=...      deno run --allow-net --allow-env --allow-read tools/help-golden.ts groq
//
// Options: --model <id> (default: the provider's fast model, as help uses),
// --wait <ms between questions, default 2500 to stay under free rate limits>.
// The key is read from the environment only and never printed.
// Exits 1 when more than 2 of the 40 fail.

import { callProvider } from '../supabase/functions/_shared/ai.ts';
import {
  buildHelpCall,
  parseHelpReply,
} from '../supabase/functions/_shared/help.ts';
import { HELP_QUESTIONS } from '../supabase/functions/_shared/help-questions.ts';
import {
  isProviderId,
  PROVIDERS,
} from '../supabase/functions/_shared/providers.ts';

const KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
} as const;

const [provider, ...rest] = Deno.args;
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
if (!isProviderId(provider) || !(provider in KEY_ENV)) {
  console.error(
    'Usage: help-golden.ts <anthropic|gemini|groq> [--model id] [--wait ms]',
  );
  Deno.exit(2);
}
const envName = KEY_ENV[provider as keyof typeof KEY_ENV];
const key = Deno.env.get(envName)?.trim();
if (!key) {
  console.error(`Set ${envName} to a ${PROVIDERS[provider].name} key first.`);
  Deno.exit(2);
}
const model = opt('model') ?? PROVIDERS[provider].fastModel;
const wait = Math.max(0, Number(opt('wait') ?? 2500) || 0);

let failed = 0;
let tokensIn = 0;
let tokensOut = 0;
for (const t of HELP_QUESTIONS) {
  const p = buildHelpCall({ question: t.q, page: t.page ?? '' });
  const a = await callProvider(provider, key, model, p.call);
  let verdict = 'FAIL';
  let detail = '';
  if (!a.ok) detail = `${a.kind} ${a.status}: ${a.message}`;
  else {
    tokensIn += a.tokensIn;
    tokensOut += a.tokensOut;
    const r = parseHelpReply(a.text, p.allowed);
    if (!r) detail = `unreadable: ${a.text.slice(0, 120)}`;
    else if (t.decline) verdict = r.found ? 'FAIL' : 'pass';
    else
      verdict =
        r.found && r.articles.includes(t.article as string) ? 'pass' : 'FAIL';
    if (r && verdict === 'FAIL')
      detail = `found=${r.found} articles=${r.articles.join(',')} "${r.answer.slice(0, 100)}"`;
  }
  if (verdict === 'FAIL') failed++;
  console.log(`  ${verdict}  ${t.q}${detail ? `\n        ${detail}` : ''}`);
  if (wait) await new Promise((r) => setTimeout(r, wait));
}
console.log(
  `\n${PROVIDERS[provider].name} ${model}: ${HELP_QUESTIONS.length - failed} of ${HELP_QUESTIONS.length} passed; ${tokensIn} tokens in, ${tokensOut} out`,
);
Deno.exit(failed > 2 ? 1 : 0);
