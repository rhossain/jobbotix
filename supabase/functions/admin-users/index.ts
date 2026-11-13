// POST /functions/v1/admin-users     (signed-in admin)
//   Authorization: Bearer <user JWT>
//   { "action": "list", "q"?: "...", "plan"?: "free"|"pro", "route"?: "own"|"credits"|"none", "limit"?: 50, "offset"?: 0 }
//   { "action": "export", ...the same filters }       every match, for the CSV
//   { "action": "get", "userId": "..." }               one account
//   { "action": "explain_search", "userId": "...", "days"?: 14 }   why their search finds what it finds
//   { "action": "recheck_roles", "userId": "...", "apply"?: true }   filed roles the current rules reject; apply moves them to Skipped
//   { "action": "money" }                              revenue, subscriptions, AI spend
//   { "action": "suspend", "userId": "...", "reason": "..." }
//   { "action": "unsuspend", "userId": "..." }
//   { "action": "login_link", "userId": "..." }        emails the user a sign-in link
//   { "action": "delete", "userId": "...", "confirmEmail": "..." }
//
// The admin console's way to accounts other than the admin's own. It checks
// the caller is an admin, reads with the service role through the functions
// of migration 0037 (which never return a resume, a letter or notes unless
// the account's owner opened support access), and records every view and
// action in admin_audit. Plans and credits are changed through their own
// database functions, which are audited by triggers.

import {
  PROFILE_COLUMNS,
  replayPool,
  toMatchProfile,
} from '../_shared/explain.ts';
import { relevance } from '../_shared/match.ts';
import { resolveWeights } from '../_shared/score.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { deleteAccount } from '../_shared/account.ts';
import {
  ADMIN_ACTIONS,
  BAN_FOREVER,
  isUuid,
  listFilters,
  refusal,
  type AdminAction,
  type Target,
} from '../_shared/admin.ts';
import { json, serviceClient } from '../_shared/auth.ts';
import { withCors } from '../_shared/cors.ts';

const APP_URL = Deno.env.get('APP_URL') ?? 'https://jobbotix.com';

Deno.serve(
  withCors(async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const jwt = req.headers
      .get('authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim();
    if (!jwt) return json(401, { error: 'Sign in first' });

    const anon = () =>
      createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { auth: { persistSession: false } },
      );
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
    const actorId = userData.user.id;

    const admin = serviceClient();
    const { data: actor } = await admin
      .from('profiles')
      .select('is_admin, suspended_at')
      .eq('id', actorId)
      .maybeSingle();
    if (!actor?.is_admin || actor.suspended_at)
      return json(403, { error: 'Admins only' });

    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const action = body['action'] as AdminAction;
    if (!(ADMIN_ACTIONS as readonly string[]).includes(action))
      return json(400, { error: 'Unknown action' });

    const audit = (
      what: string,
      target: string | null,
      detail: Record<string, unknown> = {},
      quietMinutes = 0,
    ) =>
      admin.rpc('admin_audit_write', {
        p_admin: actorId,
        p_action: what,
        p_target: target,
        p_detail: detail,
        p_quiet_minutes: quietMinutes,
      });

    // --- reads that are not about one account --------------------------------
    if (action === 'list' || action === 'export') {
      const f = listFilters(body);
      const page = (limit: number, offset: number) =>
        admin.rpc('admin_users_list', {
          p_query: f.q,
          p_plan: f.plan,
          p_route: f.route,
          p_limit: limit,
          p_offset: offset,
        });
      if (action === 'list') {
        const { data, error } = await page(f.limit, f.offset);
        if (error) return json(500, { error: error.message });
        await audit(
          'view_users',
          null,
          { q: f.q, plan: f.plan, route: f.route },
          10,
        );
        return json(200, data);
      }
      // Everything that matches, 500 at a time, up to 10,000 accounts.
      const users: unknown[] = [];
      let total = 0;
      for (let offset = 0; offset < 10_000; offset += 500) {
        const { data, error } = await page(500, offset);
        if (error) return json(500, { error: error.message });
        const batch = (data?.users ?? []) as unknown[];
        total = Number(data?.total ?? 0);
        users.push(...batch);
        if (batch.length < 500) break;
      }
      await audit('export_users', null, {
        q: f.q,
        plan: f.plan,
        route: f.route,
        count: users.length,
      });
      return json(200, { total, users });
    }
    if (action === 'money') {
      const { data, error } = await admin.rpc('admin_money');
      if (error) return json(500, { error: error.message });
      await audit('view_money', null, {}, 30);
      return json(200, data);
    }

    // --- one account ---------------------------------------------------------
    const userId = body['userId'];
    if (!isUuid(userId)) return json(400, { error: 'userId is required' });
    const { data: target } = await admin
      .from('profiles')
      .select('id, email, is_admin')
      .eq('id', userId)
      .maybeSingle();
    if (!target) return json(404, { error: 'No such account' });
    const no = refusal(action, actorId, target as Target, body);
    if (no) return json(422, { error: no });

    if (action === 'get') {
      const [{ data, error }, auth] = await Promise.all([
        admin.rpc('admin_user_detail', { p_user: userId }),
        admin.auth.admin.getUserById(userId),
      ]);
      if (error || !data)
        return json(500, {
          error: error?.message ?? 'Could not read the account',
        });
      const u = auth.data?.user as
        | {
            last_sign_in_at?: string;
            email_confirmed_at?: string;
            banned_until?: string;
          }
        | undefined;
      await audit('view_user', userId, {}, 10);
      // Reading someone's roles and resume is its own line in the trail.
      if (data.content) await audit('view_content', userId, {}, 10);
      return json(200, {
        ...data,
        auth: {
          last_sign_in_at: u?.last_sign_in_at ?? null,
          email_confirmed_at: u?.email_confirmed_at ?? null,
          banned_until: u?.banned_until ?? null,
        },
      });
    }

    if (action === 'explain_search') {
      // The match and score rules replayed over the recent pool; nothing is
      // written. It reads the account's search profile (what they look for),
      // not their roles, resume or notes.
      const days = Math.min(
        30,
        Math.max(1, Math.trunc(Number(body['days']) || 14)),
      );
      const [{ data: sp }, { data: settings }] = await Promise.all([
        admin
          .from('search_profiles')
          .select(PROFILE_COLUMNS)
          .eq('user_id', userId)
          .eq('active', true)
          .maybeSingle(),
        admin
          .from('settings')
          .select('key, value')
          .in('key', ['sourcing', 'scoring_defaults']),
      ]);
      if (!sp) return json(404, { error: 'No active search profile' });
      const setting = (k: string) =>
        (settings ?? []).find((x) => x.key === k)?.value as
          Record<string, unknown> | undefined;
      const replay = await replayPool(
        admin,
        toMatchProfile(sp),
        resolveWeights(
          setting('scoring_defaults'),
          (sp as { scoring_weights?: unknown }).scoring_weights,
        ),
        {
          days,
          threshold: Number(setting('sourcing')?.['min_file_score']) || 30,
        },
      );
      if ('error' in replay) return json(500, { error: replay.error });
      // What the AI check did in their real runs over the same days: counts
      // from the run records only (the replay above never calls a model).
      const { data: runs } = await admin
        .from('role_events')
        .select('payload')
        .eq('user_id', userId)
        .eq('kind', 'run')
        .gte(
          'created_at',
          new Date(Date.now() - days * 86_400_000).toISOString(),
        )
        .limit(1000);
      const ai = {
        runs: 0,
        looked: 0,
        turned_down: 0,
        brought_in: 0,
        failed_runs: 0,
        error: '',
      };
      for (const r of runs ?? []) {
        const pl = (r.payload ?? {}) as Record<string, unknown>;
        if (pl['source'] !== 'jobbotix') continue;
        const n = (k: string) => Number(pl[k] ?? 0) || 0;
        if (n('aiJudged') > 0) ai.runs++;
        ai.looked += n('aiJudged');
        ai.turned_down += n('aiRejected');
        ai.brought_in += n('aiRescued');
        if (n('aiFailed') > 0) {
          ai.failed_runs++;
          if (!ai.error && typeof pl['aiError'] === 'string')
            ai.error = pl['aiError'];
        }
      }
      await audit('explain_search', userId, { days }, 10);
      return json(200, { ...replay.result, ai_check: ai });
    }

    if (action === 'recheck_roles') {
      // Roles the matcher filed that today's rules would call another kind
      // of job. Only roles the user has not touched: still New, no notes,
      // nothing drafted. With apply they move to Skipped (the user can move
      // them back); nothing is deleted.
      const { data: sp } = await admin
        .from('search_profiles')
        .select(PROFILE_COLUMNS)
        .eq('user_id', userId)
        .eq('active', true)
        .maybeSingle();
      if (!sp) return json(404, { error: 'No active search profile' });
      const profile = toMatchProfile(sp);
      const { data: roles, error: rolesErr } = await admin
        .from('roles')
        .select('id, title, company, posting_id')
        .eq('user_id', userId)
        .eq('status', 'new')
        .eq('notes', '')
        .not('posting_id', 'is', null)
        .limit(1000);
      if (rolesErr) return json(500, { error: rolesErr.message });
      const ids = (roles ?? []).map((r) => r.id);
      const postingIds = [...new Set((roles ?? []).map((r) => r.posting_id))];
      const [{ data: touched }, { data: posts }] = await Promise.all([
        ids.length
          ? admin
              .from('role_events')
              .select('role_id')
              .in('role_id', ids)
              .in('kind', ['note', 'generated', 'reminder'])
          : Promise.resolve({ data: [] as { role_id: string }[] }),
        postingIds.length
          ? admin
              .from('postings')
              .select('id, title, tags, description')
              .in('id', postingIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                title: string;
                tags: string[];
                description: string;
              }[],
            }),
      ]);
      const used = new Set((touched ?? []).map((t) => t.role_id));
      const byId = new Map((posts ?? []).map((p) => [p.id, p]));
      const stale = (roles ?? []).filter((r) => {
        const p = byId.get(r.posting_id);
        return (
          p &&
          !used.has(r.id) &&
          relevance(profile, {
            title: p.title,
            tags: p.tags ?? [],
            description: p.description ?? '',
          }) === null
        );
      });
      const apply = body['apply'] === true;
      if (apply && stale.length) {
        const { error } = await admin
          .from('roles')
          .update({ status: 'skipped' })
          .in(
            'id',
            stale.map((r) => r.id),
          )
          .eq('status', 'new');
        if (error) return json(500, { error: error.message });
      }
      await audit('recheck_roles', userId, {
        found: stale.length,
        applied: apply,
      });
      return json(200, {
        checked: (roles ?? []).length,
        applied: apply,
        roles: stale
          .slice(0, 100)
          .map((r) => ({ title: r.title, company: r.company })),
        count: stale.length,
      });
    }

    if (action === 'suspend' || action === 'unsuspend') {
      const on = action === 'suspend';
      const reason = on ? String(body['reason']).trim() : '';
      // Sign-in first: if that fails, the account is not marked suspended.
      const { error: banError } = await admin.auth.admin.updateUserById(
        userId,
        {
          ban_duration: on ? BAN_FOREVER : 'none',
        },
      );
      if (banError) return json(500, { error: banError.message });
      const { error } = await admin
        .from('profiles')
        .update({
          suspended_at: on ? new Date().toISOString() : null,
          suspended_reason: reason,
        })
        .eq('id', userId);
      if (error) return json(500, { error: error.message });
      await audit(action, userId, on ? { reason } : {});
      return json(200, { suspended: on });
    }

    if (action === 'login_link') {
      // The same email the sign-in page sends; nothing is shown to the admin.
      const { error } = await anon().auth.signInWithOtp({
        email: target.email,
        options: { shouldCreateUser: false, emailRedirectTo: APP_URL },
      });
      if (error) return json(502, { error: error.message });
      await audit('send_login_link', userId);
      return json(200, { sent: true });
    }

    // delete: the trail first, while the account's email can still be read
    await audit('delete_account', userId, { email: target.email });
    const failed = await deleteAccount(admin, userId);
    if (failed) {
      await audit('delete_account_failed', userId, {
        error: failed.slice(0, 300),
      });
      return json(500, { error: failed });
    }
    return json(200, { deleted: true });
  }),
);
