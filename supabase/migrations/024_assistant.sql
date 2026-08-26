-- Sanchaya Assistant (product expansion): a conversational agent layer that
-- can read across the faculty's existing data (Action Inbox, GrantOps,
-- Repository, etc.) and, when it wants to take a write action, proposes an
-- explicit, reviewable action_plan the faculty must approve before anything
-- executes -- never a silent autonomous write. assistant_tool_permissions
-- lets a faculty member upgrade a given tool scope from "ask every time" to
-- "always allow" once they trust it, mirroring the propose-then-confirm
-- pattern already used for grant awards (015_grantops.sql) and event
-- attendance credit.

create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assistant_conversations_profile_idx on public.assistant_conversations(profile_id, updated_at desc);
drop trigger if exists assistant_conversations_updated_at on public.assistant_conversations;
create trigger assistant_conversations_updated_at before update on public.assistant_conversations for each row execute function public.set_updated_at();

alter table public.assistant_conversations enable row level security;

drop policy if exists assistant_conversations_owner on public.assistant_conversations;
create policy assistant_conversations_owner on public.assistant_conversations for all to authenticated using (
  assistant_conversations.profile_id = auth.uid()
) with check (
  assistant_conversations.profile_id = auth.uid()
);

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text,
  tool_calls jsonb,
  tool_result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists assistant_messages_conversation_idx on public.assistant_messages(conversation_id, created_at);

alter table public.assistant_messages enable row level security;

drop policy if exists assistant_messages_owner on public.assistant_messages;
create policy assistant_messages_owner on public.assistant_messages for all to authenticated using (
  exists(
    select 1 from public.assistant_conversations c
    where c.id = assistant_messages.conversation_id and c.profile_id = auth.uid()
  )
) with check (
  exists(
    select 1 from public.assistant_conversations c
    where c.id = assistant_messages.conversation_id and c.profile_id = auth.uid()
  )
);

create table if not exists public.assistant_action_plans (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'executing', 'completed', 'failed', 'expired')),
  steps jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  executed_at timestamptz
);
create index if not exists assistant_action_plans_profile_idx on public.assistant_action_plans(profile_id, status);

alter table public.assistant_action_plans enable row level security;

drop policy if exists assistant_action_plans_owner on public.assistant_action_plans;
create policy assistant_action_plans_owner on public.assistant_action_plans for all to authenticated using (
  assistant_action_plans.profile_id = auth.uid()
) with check (
  assistant_action_plans.profile_id = auth.uid()
);

create table if not exists public.assistant_tool_permissions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null,
  mode text not null default 'ask' check (mode in ('ask', 'always_allow')),
  granted_at timestamptz not null default now(),
  unique (profile_id, scope)
);

alter table public.assistant_tool_permissions enable row level security;

drop policy if exists assistant_tool_permissions_owner on public.assistant_tool_permissions;
create policy assistant_tool_permissions_owner on public.assistant_tool_permissions for all to authenticated using (
  assistant_tool_permissions.profile_id = auth.uid()
) with check (
  assistant_tool_permissions.profile_id = auth.uid()
);

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.assistant_messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.assistant_action_plans; exception when duplicate_object then null; end;
  end if;
end $$;
