-- Current Claude models (Nov 2026). The app's model list now comes from
-- Anthropic's Models API (list-models); these are the defaults and the
-- built-in list used without a key.
alter table public.profiles
  alter column default_model set default 'claude-sonnet-5-5';

-- Accounts still on the old default move to the new one; a model someone
-- picked on purpose is left alone.
update public.profiles
  set default_model = 'claude-sonnet-5-5'
  where default_model = 'claude-sonnet-4-5';

update public.settings
  set value = '{"default": "claude-sonnet-5-5", "choices": ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]}'::jsonb
  where key = 'models';

update public.settings
  set value = jsonb_set(value, '{triage_model}', '"claude-haiku-5-5"')
  where key = 'sourcing' and value->>'triage_model' = 'claude-haiku-4-5';
