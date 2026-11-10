// The full check of an AI provider from a terminal: the four core jobs
// (supabase/functions/_shared/golden.ts) once each, or several rounds, with
// a key from the environment. The same check runs from Settings ("Full
// check" on a connection); this is for trying a provider or a model before
// it goes in the catalog.
//
//   GEMINI_API_KEY=...  deno run --allow-net --allow-env tools/ai-golden.ts gemini
//   GROQ_API_KEY=...    deno run --allow-net --allow-env tools/ai-golden.ts groq --model llama-3.3-70b-versatile
//   ANTHROPIC_API_KEY=... deno run --allow-net --allow-env tools/ai-golden.ts anthropic --rounds 3
//
// Options: --model <id> (default: the provider's), --rounds <n> (default 1),
// --jobs score,extract,tailor,letter, --wait <seconds between rounds, default 60>.
// The key is read from the environment only and never printed.
// Exits 1 when any job that ran failed.

import {
  goldenSummary,
  runGolden,
  type GoldenJob,
  type GoldenResult,
} from '../supabase/functions/_shared/golden.ts';
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

if (!isProviderId(provider)) {
  console.error(
    `Usage: ai-golden.ts <${Object.keys(PROVIDERS).join('|')}> [--model id] [--rounds n] [--jobs a,b] [--wait seconds]`,
  );
  Deno.exit(2);
}
const key = Deno.env.get(KEY_ENV[provider])?.trim();
if (!key) {
  console.error(
    `Set ${KEY_ENV[provider]} to a ${PROVIDERS[provider].name} key first.`,
  );
  Deno.exit(2);
}

const model = opt('model') ?? '';
const rounds = Math.max(1, Number(opt('rounds') ?? 1) || 1);
const wait = Math.max(0, Number(opt('wait') ?? 60) || 0);
const jobs = opt('jobs')?.split(',') as GoldenJob[] | undefined;

const all: GoldenResult[] = [];
for (let round = 1; round <= rounds; round++) {
  if (round > 1 && wait) {
    console.log(`\nWaiting ${wait}s for the rate limit window…`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  const results = await runGolden(provider, key, model, { jobs });
  all.push(...results);
  console.log(`\n${PROVIDERS[provider].name}, round ${round} of ${rounds}`);
  for (const r of results)
    console.log(
      `  ${r.ok ? 'pass' : r.limited ? 'skip' : 'FAIL'}  ${r.label.padEnd(24)} ${r.model.padEnd(28)} ${String(r.ms).padStart(6)} ms  ${r.tokensIn}/${r.tokensOut} tokens${r.detail ? `\n        ${r.detail}` : ''}`,
    );
}
console.log(`\n${goldenSummary(all)}`);
Deno.exit(all.some((r) => !r.ok && !r.limited) ? 1 : 0);
