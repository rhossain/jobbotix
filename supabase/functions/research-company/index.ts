// POST /functions/v1/research-company     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "roleId": "...", "model"?: "provider:model", "refresh"?: true }
//
// Researches the employer behind one of the caller's roles and stores it on
// the role (roles.company_research).
//
//   With an Anthropic connection: the model searches the web (Anthropic's
//   web search tool, billed to that key per search) and returns the fields
//   in company.ts, with sources. If web search is not enabled for the key's
//   organisation, the model answers from the posting and what it knows, and
//   the note says so. Anthropic goes first for this job, whatever the order
//   of the connections, because it is the one that can search; a model picked
//   from another provider overrides that.
//   With another provider only (or when Anthropic fails): that model answers
//   from the posting and what it knows, without sources; the note says so.
//   Without a connection: what the posting says about the company, plus the
//   company site's own description when the posting lives on its site.
//   Every model call is metered in ai_usage as 'research'.
//
// Research for the same company on another of the user's roles, less than
// 30 days old, is reused unless "refresh" is set. So is a web research
// Jobbotix paid for on any account in the last 30 days (research-cache.ts):
// it costs no credits, and "refresh" or a picked model searches again.

import { loadConnections, runAi } from '../_shared/ai.ts';
import { callMessages } from '../_shared/anthropic.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, serviceClient } from '../_shared/auth.ts';
import {
  localCompanyResearch,
  parseResearchReply,
  researchPrompt,
  type CompanyResearch,
  type CompanySource,
} from '../_shared/company.ts';
import { withCors } from '../_shared/cors.ts';
import { normaliseCompany } from '../_shared/sources/normalise.ts';
import {
  creditNote,
  platformKey,
  release,
  reserve,
  settle,
} from '../_shared/credits.ts';
import { requireAiJob } from '../_shared/gate.ts';
import {
  readResearch,
  sharedNote,
  writeResearch,
} from '../_shared/research-cache.ts';
import {
  parseModelChoice,
  providerName,
  resolveModel,
} from '../_shared/providers.ts';
import { readVaultSecret } from '../_shared/vault.ts';

const REUSE_DAYS = 30;
const MAX_SEARCHES = 5;

Deno.serve(
  withCors(async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const jwt = req.headers
      .get('authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim();
    if (!jwt) return json(401, { error: 'Sign in first' });

    const asUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      },
    );
    const { data: userData } = await asUser.auth.getUser();
    if (!userData?.user)
      return json(401, { error: 'Session expired; sign in again' });
    const userId = userData.user.id;

    const body = (await req.json().catch(() => ({}))) as {
      roleId?: string;
      model?: string;
      refresh?: boolean;
    };
    if (!body.roleId) return json(400, { error: 'roleId is required' });
    const roleId = body.roleId;

    const admin = serviceClient();
    const gate = await requireAiJob(admin, userId, 'research');
    if (gate instanceof Response) return gate;
    const [{ data: role }, connections] = await Promise.all([
      admin
        .from('roles')
        .select('id, company, title, url, posting_text')
        .eq('id', roleId)
        .eq('user_id', userId)
        .maybeSingle(),
      loadConnections(admin, userId),
    ]);
    if (!role) return json(404, { error: 'Role not found' });

    const save = async (
      research: CompanyResearch,
      reused: boolean,
      shared = false,
    ) => {
      const { error } = await admin
        .from('roles')
        .update({ company_research: research })
        .eq('id', roleId)
        .eq('user_id', userId);
      if (error) return json(500, { error: error.message });
      await admin.from('role_events').insert({
        user_id: userId,
        role_id: roleId,
        kind: 'generated',
        payload: {
          what: 'company research',
          method: research.method,
          model: research.model,
          provider: research.provider,
          reused,
          ...(shared ? { shared: true } : {}),
        },
      });
      // shared: reused from Jobbotix's own recent research, not the caller's
      return json(200, { research, reused, shared });
    };

    // 1. Same company researched recently on another role?
    if (!body.refresh) {
      const key = normaliseCompany(role.company);
      const { data: others } = await admin
        .from('roles')
        .select('company, company_research')
        .eq('user_id', userId)
        .neq('id', roleId)
        .ilike('company', role.company)
        .limit(20);
      const since = Date.now() - REUSE_DAYS * 86_400_000;
      const hit = (others ?? [])
        .filter((o) => normaliseCompany(o.company) === key)
        .map((o) => o.company_research as Partial<CompanyResearch> | null)
        .filter(
          (r): r is CompanyResearch =>
            !!r?.researchedAt && Date.parse(r.researchedAt) >= since,
        )
        .sort((a, b) => b.researchedAt.localeCompare(a.researchedAt))[0];
      if (hit) return await save(hit, true);
    }

    const text = (role.posting_text ?? '').slice(0, 40_000);
    const local = localCompanyResearch({
      company: role.company,
      url: role.url,
      text,
    });

    const merge = (
      found: CompanyResearch,
      by: {
        provider: string;
        model: string;
        webSearch: boolean;
        note?: string;
      },
    ): CompanyResearch => ({
      ...found,
      website: found.website || local.website,
      remoteHiring: found.remoteHiring.length
        ? found.remoteHiring
        : local.remoteHiring,
      redFlags: [
        ...found.redFlags,
        ...local.redFlags.filter((f) => !found.redFlags.includes(f)),
      ].slice(0, 5),
      sources: dedupeSources([
        ...found.sources,
        ...(role.url ? [{ title: 'The posting', url: role.url }] : []),
      ]),
      researchedAt: new Date().toISOString(),
      method: 'ai',
      ...by,
    });
    const picked = parseModelChoice(body.model);
    const failures: string[] = [];

    // 1b. Researched with web search on Jobbotix's key, for anyone, in the
    //     last 30 days? Then there is nothing to search and nothing to charge.
    //     What this posting says about hiring and risks is added to it.
    if (!body.refresh && !picked) {
      const shared = await readResearch(admin, role.company, {
        site: local.website,
      });
      if (shared)
        return await save(
          {
            ...merge(shared.research, {
              provider: 'anthropic',
              model: shared.model,
              webSearch: true,
              note: sharedNote(role.company, shared.researchedAt),
            }),
            researchedAt: shared.researchedAt,
          },
          true,
          true,
        );
    }

    const logOwn = (model: string, u: Usage) =>
      u.tokensIn || u.tokensOut || u.webSearches
        ? admin.from('ai_usage').insert({
            user_id: userId,
            job: 'research',
            provider: 'anthropic',
            model,
            tokens_in: u.tokensIn,
            tokens_out: u.tokensOut,
            web_searches: u.webSearches,
            cost_usd: 0,
          })
        : Promise.resolve();

    /** Claude with web search; without it when the key's organisation has none. */
    const withClaude = async (apiKey: string, model: string) => {
      const first = await askModel(apiKey, model, role, text, true);
      const noSearch = 'searchUnavailable' in first.result;
      const second = noSearch
        ? await askModel(apiKey, model, role, text, false)
        : null;
      const result = second ? second.result : first.result;
      const usage: Usage = {
        tokensIn: first.usage.tokensIn + (second?.usage.tokensIn ?? 0),
        tokensOut: first.usage.tokensOut + (second?.usage.tokensOut ?? 0),
        webSearches: first.usage.webSearches + (second?.usage.webSearches ?? 0),
      };
      return { result, usage, webSearch: !noSearch };
    };

    // 2. Credits: Jobbotix's own key with web search. First for a paying
    //    account (unless a model of its own was picked); the fallback, in
    //    step 5, for an account on trial credits.
    const platform = platformKey();
    let creditsAsked = false;
    let refusal = '';
    const onCredits = async (firstOnly: boolean): Promise<Response | null> => {
      const hold = await reserve(admin, userId, 'research', firstOnly);
      if (!hold.ok) {
        if (hold.reason !== 'fallback') {
          creditsAsked = true;
          refusal = creditNote(hold);
        }
        return null;
      }
      creditsAsked = true;
      const out = await withClaude(platform, hold.model);
      if ('research' in out.result) {
        await settle(admin, hold.hold, out.usage);
        // Paid for from Jobbotix's key: the next account to ask about this
        // company within 30 days gets it without a search.
        await writeResearch(admin, role.company, out.result.research, {
          postingUrl: role.url,
          webSearch: out.webSearch,
          model: hold.model,
        });
        return await save(
          merge(out.result.research, {
            provider: 'anthropic',
            model: hold.model,
            webSearch: out.webSearch,
          }),
          false,
        );
      }
      // The reason is about Jobbotix's own key: for the logs, not the user.
      console.error(
        'platform research failed:',
        'failed' in out.result ? out.result.failed : 'web search unavailable',
      );
      if (out.usage.tokensIn || out.usage.tokensOut)
        await settle(admin, hold.hold, out.usage, false);
      else await release(admin, hold.hold);
      failures.push(
        'Jobbotix AI could not finish the research just now; no credits were used.',
      );
      return null;
    };
    if (platform && !picked) {
      const done = await onCredits(true);
      if (done) return done;
    }

    // 3. The account's own Anthropic key with web search, unless a model of
    //    another provider was picked for this run
    const claude = connections.find((c) => c.provider === 'anthropic');
    const claudeLimited =
      !!claude?.limited_until && Date.parse(claude.limited_until) > Date.now();
    if (
      claude &&
      !claudeLimited &&
      (!picked || picked.provider === 'anthropic')
    ) {
      const apiKey = await readVaultSecret(admin, claude.key_ref);
      if (apiKey) {
        const model = resolveModel('anthropic', claude.model, {
          choice: body.model,
        });
        const out = await withClaude(apiKey, model);
        await logOwn(model, out.usage);
        if ('research' in out.result)
          return await save(
            merge(out.result.research, {
              provider: 'anthropic',
              model,
              webSearch: out.webSearch,
              note: out.webSearch
                ? undefined
                : 'Web search is not enabled for your Anthropic key, so this is from the posting and what the model already knows. Enable web search for your organisation in the Anthropic Console for fresh, sourced research.',
            }),
            false,
          );
        failures.push(
          'failed' in out.result
            ? out.result.failed
            : 'The Anthropic call failed',
        );
      } else
        failures.push(
          'The saved Anthropic key could not be read. Add it again in Settings.',
        );
    }

    // 4. Any other connection: the model answers without searching the web
    const others = await runAi(
      admin,
      userId,
      {
        prompt: researchPrompt({
          company: role.company,
          title: role.title,
          url: role.url,
          text,
          webSearch: false,
        }),
        maxTokens: 2500,
        timeoutMs: 90_000,
      },
      {
        job: 'research',
        choice: body.model,
        skip: ['anthropic'],
        connections,
        // credits are handled here, with web search (steps 2 and 5)
        platform: false,
        parse: parseResearchReply,
      },
    );
    if (others.ok)
      return await save(
        merge(others.value, {
          provider: others.provider,
          model: others.model,
          webSearch: false,
          note: `${providerName(others.provider)} cannot search the web, so this is from the posting and what the model already knows; check anything that matters. ${
            claude
              ? ''
              : 'Connect an Anthropic key in Settings for fresh, sourced research.'
          }`.trim(),
        }),
        false,
      );
    if (others.reason !== 'no_connection') failures.push(others.message);

    // 5. Credits as the fallback (trial credits, or a picked model that failed)
    if (platform && !creditsAsked) {
      const done = await onCredits(false);
      if (done) return done;
    }
    if (refusal) failures.push(refusal);
    if (failures.length)
      local.note = `${failures.join(' ')} Showing what the posting says instead.`;

    // 6. No connection (or every model failed): the posting, plus the
    //    company's own site
    if (local.website) {
      const site = await siteDescription(local.website);
      if (site) {
        if (!local.summary) local.summary = site.description;
        else if (!local.product.includes(site.description))
          local.product.unshift(site.description);
        local.sources = dedupeSources([
          ...local.sources,
          { title: site.title || 'Company website', url: local.website },
        ]);
      }
    }
    if (!connections.length && !creditsAsked)
      local.note ??=
        'From the posting and the company site only. Add an AI connection in Settings for more; an Anthropic key gives full web research (size, funding, reviews, news).';
    return await save(local, false);
  }),
);

type ModelResult =
  | { research: CompanyResearch }
  | { failed: string }
  | { searchUnavailable: true };

interface Usage {
  tokensIn: number;
  tokensOut: number;
  webSearches: number;
}

/** One research call; the caller logs or settles what it used. */
async function askModel(
  apiKey: string,
  model: string,
  role: { company: string; title: string; url: string },
  text: string,
  webSearch: boolean,
): Promise<{ result: ModelResult; usage: Usage }> {
  const usage: Usage = { tokensIn: 0, tokensOut: 0, webSearches: 0 };
  return {
    result: await research(apiKey, model, role, text, webSearch, usage),
    usage,
  };
}

async function research(
  apiKey: string,
  model: string,
  role: { company: string; title: string; url: string },
  text: string,
  webSearch: boolean,
  usage: Usage,
): Promise<ModelResult> {
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    {
      role: 'user',
      content: researchPrompt({
        company: role.company,
        title: role.title,
        url: role.url,
        text,
        webSearch,
      }),
    },
  ];
  const content: Record<string, unknown>[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let searches = 0;
  try {
    // A long search can pause the turn; continue it a couple of times.
    for (let turn = 0; turn < 3; turn++) {
      const res = await callMessages(
        apiKey,
        {
          model,
          max_tokens: 2500,
          messages,
          ...(webSearch
            ? {
                tools: [
                  {
                    type: 'web_search_20250305',
                    name: 'web_search',
                    max_uses: MAX_SEARCHES,
                  },
                ],
              }
            : {}),
        },
        100_000,
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = String(payload?.error?.message ?? res.statusText);
        if (webSearch && /web[_ ]search/i.test(detail))
          return { searchUnavailable: true };
        return { failed: `Anthropic ${res.status}: ${detail.slice(0, 200)}` };
      }
      const blocks = Array.isArray(payload?.content) ? payload.content : [];
      content.push(...blocks);
      tokensIn += Number(payload?.usage?.input_tokens ?? 0);
      tokensOut += Number(payload?.usage?.output_tokens ?? 0);
      searches += Number(
        payload?.usage?.server_tool_use?.web_search_requests ?? 0,
      );
      if (payload?.stop_reason !== 'pause_turn') break;
      messages.splice(1, messages.length - 1, {
        role: 'assistant',
        content: [...content],
      });
    }
  } catch (e) {
    return { failed: (e as Error).message || 'Model call failed' };
  } finally {
    usage.tokensIn = tokensIn;
    usage.tokensOut = tokensOut;
    usage.webSearches = searches;
  }

  // A search that errored for the whole account (not enabled) shows up as a
  // tool result error rather than a failed request.
  const searchErrors = content.filter(
    (b) =>
      b['type'] === 'web_search_tool_result' &&
      !Array.isArray(b['content']) &&
      (b['content'] as Record<string, unknown> | undefined)?.['type'] ===
        'web_search_tool_result_error',
  );
  if (webSearch && !searches && searchErrors.length)
    return { searchUnavailable: true };

  const reply = content
    .filter((b) => b['type'] === 'text')
    .map((b) => String(b['text'] ?? ''))
    .join('');
  const research = parseResearchReply(reply);
  if (!research) return { failed: 'The model reply had no usable research' };

  // Pages the model actually cited come first, then the ones it listed.
  const cited: CompanySource[] = content
    .filter((b) => b['type'] === 'text' && Array.isArray(b['citations']))
    .flatMap((b) => b['citations'] as Record<string, unknown>[])
    .map((c) => ({
      title: String(c['title'] ?? ''),
      url: String(c['url'] ?? ''),
    }))
    .filter((c) => /^https?:\/\//.test(c.url));
  research.sources = dedupeSources([...cited, ...research.sources]);
  return { research };
}

function dedupeSources(sources: CompanySource[]): CompanySource[] {
  const seen = new Set<string>();
  const out: CompanySource[] = [];
  for (const s of sources) {
    const key = s.url.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (!s.url || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: s.title || new URL(s.url).hostname, url: s.url });
  }
  return out.slice(0, 10);
}

/** The company homepage's own title and description, if it gives one. */
async function siteDescription(
  url: string,
): Promise<{ title: string; description: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; Jobbotix/1.0; +https://jobbotix.com)',
        accept: 'text/html,*/*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 200_000);
    const meta = (name: string) =>
      html.match(
        new RegExp(
          `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']{20,400})["']`,
          'i',
        ),
      )?.[1] ??
      html.match(
        new RegExp(
          `<meta[^>]+content=["']([^"']{20,400})["'][^>]*(?:name|property)=["']${name}["']`,
          'i',
        ),
      )?.[1];
    const description = decode(
      meta('description') ?? meta('og:description') ?? '',
    );
    const title = decode(html.match(/<title[^>]*>([^<]{2,120})</i)?.[1] ?? '');
    return description
      ? { title: title.trim(), description: description.trim() }
      : null;
  } catch {
    return null;
  }
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}
