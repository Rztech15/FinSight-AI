-- FinSight AI — optional Supabase schema (run once in the Supabase SQL editor).
-- Stores ONLY the tamper-evident audit log of approvals/sandbox runs. Financial transactions are never stored.
create table if not exists public.audit_events (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  seq        integer not null check (seq > 0),
  ts         timestamptz not null,
  actor      text not null,
  event      text not null,
  details    jsonb not null default '{}'::jsonb,
  prev_hash  text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash       text not null check (hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, seq)
);

alter table public.audit_events enable row level security;

-- Users can read and append their own rows. No update or delete policy exists, so rows are immutable.
drop policy if exists "audit select own" on public.audit_events;
create policy "audit select own" on public.audit_events for select using (auth.uid() = user_id);
drop policy if exists "audit insert own" on public.audit_events;
create policy "audit insert own" on public.audit_events for insert with check (auth.uid() = user_id);

revoke update, delete on public.audit_events from anon, authenticated;
