// POST /functions/v1/research-company     (signed-in user)
//   Authorization: Bearer <user JWT>
//   { "roleId": "...", "model"?: "claude-...", "refresh"?: true }
//
// Researches the employer behind one of the caller's roles and stores it on
// the role (roles.company_research).
//
//   With an Anthropic key in Vault: the model searches the web (Anthropic's
//   web search tool, billed to that key per search) and returns the fields
//   in company.ts, with sources. If web search is not enabled for the key's
//   organisation, the model answers from the posting and what it knows, and
//   the note says so. Metered in ai_usage as 'research'.
//   Without a key: what the posting says about the company, plus the
//   company site's own description when the posting lives on its site.
//
// Research for the same company on another of the user's roles, less than
// 30 days old, is reused unless "refresh" is set.

import { DEFAULT_MODEL } from '../_shared/models.ts';
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
    const [{ data: role }, { data: profile }] = await Promise.all([
      admin
        .from('roles')
        .select('id, company, title, url, posting_text')
        .eq('id', roleId)
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('profiles')
        .select('anthropic_key_ref, default_model')
        .eq('id', userId)
        .maybeSingle(),
    ]);
    if (!role) return json(404, { error: 'Role not found' });

    const save = async (research: CompanyResearch, reused: boolean) => {
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
          reused,
        },
      });
      return json(200, { research, reused });
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

    // 2. Model with web search on the user's key
    const apiKey = profile?.anthropic_key_ref
      ? await readVaultSecret(admin, profile.anthropic_key_ref)
      : null;
    if (apiKey) {
      const model = body.model || profile?.default_model || DEFAULT_MODEL;
      const withSearch = await askModel(
        admin,
        userId,
        apiKey,
        model,
        role,
        text,
        true,
      );
      let result = withSearch;
      let note: string | undefined;
      if ('searchUnavailable' in withSearch) {
        result = await askModel(
          admin,
          userId,
          apiKey,
          model,
          role,
          text,
          false,
        );
        note =
          'Web search is not enabled for your Anthropic key, so this is from the posting and what the model already knows. Enable web search for your organisation in the Anthropic Console for fresh, sourced research.';
      }
      if ('research' in result) {
        const merged: CompanyResearch = {
          ...result.research,
          website: result.research.website || local.website,
          remoteHiring: result.research.remoteHiring.length
            ? result.research.remoteHiring
            : local.remoteHiring,
          redFlags: [
            ...result.research.redFlags,
            ...local.redFlags.filter(
              (f) => !result.research.redFlags.includes(f),
            ),
          ].slice(0, 5),
          sources: dedupeSources([
            ...result.research.sources,
            ...(role.url ? [{ title: 'The posting', url: role.url }] : []),
          ]),
          researchedAt: new Date().toISOString(),
          method: 'ai',
          model,
          webSearch: !('searchUnavailable' in withSearch),
          note,
        };
        return await save(merged, false);
      }
      local.note = `${'failed' in result ? result.failed : 'The model call failed'}. Showing what the posting says instead.`;
    }

    // 3. No key (or the model failed): the posting, plus the company's own site
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
    if (!apiKey)
      local.note ??=
        'From the posting and the company site only. Add your Anthropic key in Settings for full web research (size, funding, reviews, news).';
    return await save(local, false);
  }),
);

type ModelResult =
  | { research: CompanyResearch }
  | { failed: string }
  | { searchUnavailable: true };

async function askModel(
  admin: ReturnType<typeof serviceClient>,
  userId: string,
  apiKey: string,
  model: string,
  role: { company: string; title: string; url: string },
  text: string,
  webSearch: boolean,
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
    if (tokensIn || tokensOut || searches)
      await admin.from('ai_usage').insert({
        user_id: userId,
        job: 'research',
        model,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        web_searches: searches,
        cost_usd: 0,
      });
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
