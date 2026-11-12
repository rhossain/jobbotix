-- One extraction per posting (subscription TODO, section 5).
--
-- When someone adds a posting by hand, a model reads it into fields (company,
-- title, location, type, salary, stack, date). The same posting added by a
-- second person gave the same fields for a second model call. This table
-- keeps the fields once, under a fingerprint of the posting's address and
-- text, so the second person gets them without a call.
--
-- A row holds what the posting says and which model read it. It does not
-- hold who added the posting: nothing here belongs to an account. Only the
-- Edge Functions (service role) read and write it; there are no policies.

create table public.posting_extractions (
  -- sha256 of the posting's cleaned address and text, in hex
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  extraction jsonb not null check (jsonb_typeof(extraction) = 'object'),
  provider text not null default '',
  model text not null default '',
  created_at timestamptz not null default now()
);
create index posting_extractions_created on public.posting_extractions (created_at);
alter table public.posting_extractions enable row level security;
