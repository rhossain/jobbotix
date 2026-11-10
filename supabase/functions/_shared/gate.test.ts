import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { OPEN_ENTITLEMENTS } from './entitlements.ts';
import {
  loadEntitlements,
  requireAiJob,
  requireFeature,
  type RpcClient,
} from './gate.ts';

/** A stand-in for the service client that answers entitlements_for. */
function fake(answer: {
  data?: unknown;
  error?: { message: string };
  throws?: boolean;
}) {
  const calls: { fn: string; args: unknown }[] = [];
  const admin = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      if (answer.throws) return Promise.reject(new Error('network down'));
      return Promise.resolve({
        data: answer.data ?? null,
        error: answer.error ?? null,
      });
    },
  } as unknown as RpcClient;
  return { admin, calls };
}

const free = {
  enforced: true,
  plan: 'free',
  plan_name: 'Free',
  status: 'none',
  features: ['ai'],
  limits: { search_profiles: 1 },
  monthly_credits: 0,
  credits: 0,
};
const pro = {
  ...free,
  plan: 'pro',
  plan_name: 'Pro',
  status: 'active',
  features: ['ai', 'company_research'],
};
const open = {
  ...free,
  enforced: false,
  features: ['ai', 'company_research'],
  limits: {},
};

Deno.test('asks the database for that user', async () => {
  const { admin, calls } = fake({ data: pro });
  const e = await loadEntitlements(admin, 'user-1');
  assertEquals(calls, [{ fn: 'entitlements_for', args: { p_user: 'user-1' } }]);
  assertEquals(e.plan, 'pro');
});

Deno.test(
  'Free under enforced billing: AI on its own key goes ahead',
  async () => {
    const gate = await requireAiJob(fake({ data: free }).admin, 'u', 'letter');
    assertEquals(gate instanceof Response, false);
  },
);

Deno.test(
  'Free under enforced billing: company research answers 402 with an upgrade hint',
  async () => {
    const gate = await requireAiJob(
      fake({ data: free }).admin,
      'u',
      'research',
    );
    if (!(gate instanceof Response)) throw new Error('expected a Response');
    assertEquals(gate.status, 402);
    assertEquals(await gate.json(), {
      error: 'Company research is part of Jobbotix Pro.',
      code: 'upgrade_required',
      feature: 'company_research',
      plan: 'free',
    });
  },
);

Deno.test('Pro may research', async () => {
  const gate = await requireFeature(
    fake({ data: pro }).admin,
    'u',
    'company_research',
  );
  assertEquals(gate instanceof Response, false);
});

Deno.test('billing off: nothing is blocked', async () => {
  const gate = await requireAiJob(fake({ data: open }).admin, 'u', 'research');
  assertEquals(gate instanceof Response, false);
});

Deno.test(
  'a failed lookup lets the call through instead of locking the account out',
  async () => {
    for (const answer of [
      { error: { message: 'function does not exist' } },
      { throws: true },
      { data: 'garbage' },
    ]) {
      const gate = await requireAiJob(fake(answer).admin, 'u', 'research');
      assertEquals(gate, OPEN_ENTITLEMENTS);
    }
  },
);

Deno.test(
  'a suspended account is refused with 403, whatever its plan',
  async () => {
    for (const job of ['letter', 'research'] as const) {
      const gate = await requireAiJob(
        fake({ data: { ...free, plan: 'pro', suspended: true } }).admin,
        'u',
        job,
      );
      assert(gate instanceof Response);
      assertEquals((gate as Response).status, 403);
      assertEquals((await (gate as Response).json()).code, 'suspended');
    }
    // billing off does not lift a suspension
    const open = await requireAiJob(
      fake({ data: { ...free, enforced: false, suspended: true } }).admin,
      'u',
      'letter',
    );
    assertEquals((open as Response).status, 403);
  },
);
