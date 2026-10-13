-- Ledger — Supabase schema
-- Run this once in your Supabase project: Dashboard -> SQL Editor -> New query.

create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  amount      numeric(12, 2) not null check (amount > 0),
  category    text not null,
  description text,
  date        date not null,
  created_at  timestamptz not null default now()
);

create index if not exists expenses_date_idx on public.expenses (date desc);

alter table public.expenses enable row level security;

-- Access policies for the browser (anon) key.
-- These allow anyone holding the anon key to read/write/delete.
-- Fine for a personal tracker; tighten this if you later add user auth.
drop policy if exists "ledger anon read" on public.expenses;
drop policy if exists "ledger anon insert" on public.expenses;
drop policy if exists "ledger anon update" on public.expenses;
drop policy if exists "ledger anon delete" on public.expenses;

create policy "ledger anon read"   on public.expenses for select using (true);
create policy "ledger anon insert" on public.expenses for insert with check (true);
create policy "ledger anon update" on public.expenses for update using (true) with check (true);
create policy "ledger anon delete" on public.expenses for delete using (true);

grant select, insert, update, delete on public.expenses to anon, authenticated;
