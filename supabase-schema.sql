-- Ledger — Supabase setup
--
-- 1. Open Supabase → SQL Editor → New query and run:
--
--      select encode(gen_random_bytes(24), 'hex') as ledger_key;
--
--    Copy the result. That is your ledger key (for the website dialog and the
--    iPhone Shortcut). Keep it somewhere safe.
-- 2. Paste it into v_key below (replace 'PASTE_YOUR_KEY_HERE').
-- 3. Run this whole file.
--
-- Design: the expenses table is NOT exposed to the anon key. RLS is on with no
-- policies, and every read/write goes through SECURITY DEFINER functions that
-- check the hashed ledger key. Rerunning this file with a new v_key rotates it.

create extension if not exists pgcrypto;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  amount numeric(12, 2) not null check (amount > 0),
  category text not null default 'Other',
  description text not null default '',
  date date not null default current_date,
  source text not null default 'web',
  created_at timestamptz not null default now()
);

create index if not exists expenses_date_idx
  on public.expenses (date desc, created_at desc);

create table if not exists public.ledger_config (
  id smallint primary key default 1 check (id = 1),
  key_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.expenses enable row level security;
alter table public.ledger_config enable row level security;

revoke all on public.expenses from anon, authenticated;
revoke all on public.ledger_config from anon, authenticated;

create or replace function public._ledger_ok(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  return exists (
    select 1
    from public.ledger_config
    where id = 1
      and key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex')
  );
end;
$$;

revoke all on function public._ledger_ok(text) from public, anon, authenticated;

create or replace function public.ledger_list(p_key text)
returns setof public.expenses
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public._ledger_ok(p_key) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  return query
    select * from public.expenses
    order by date desc, created_at desc;
end;
$$;

create or replace function public.ledger_add(
  p_key text,
  p_amount numeric,
  p_category text default 'Other',
  p_description text default '',
  p_date date default current_date,
  p_source text default 'shortcut',
  p_id uuid default null
)
returns public.expenses
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.expenses;
begin
  if not public._ledger_ok(p_key) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  insert into public.expenses (id, amount, category, description, date, source)
  values (
    coalesce(p_id, gen_random_uuid()),
    p_amount,
    coalesce(nullif(trim(p_category), ''), 'Other'),
    coalesce(p_description, ''),
    coalesce(p_date, current_date),
    coalesce(nullif(trim(p_source), ''), 'shortcut')
  )
  on conflict (id) do nothing
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.ledger_update(
  p_key text,
  p_id uuid,
  p_amount numeric,
  p_category text,
  p_description text,
  p_date date
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public._ledger_ok(p_key) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  update public.expenses
  set amount = p_amount,
      category = coalesce(nullif(trim(p_category), ''), category),
      description = coalesce(p_description, ''),
      date = coalesce(p_date, date)
  where id = p_id;

  return found;
end;
$$;

create or replace function public.ledger_delete(p_key text, p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public._ledger_ok(p_key) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  delete from public.expenses where id = p_id;
  return found;
end;
$$;

create or replace function public.ledger_clear(p_key text)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_count integer;
begin
  if not public._ledger_ok(p_key) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  delete from public.expenses;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.ledger_list(text) from public, anon, authenticated;
revoke all on function public.ledger_add(text, numeric, text, text, date, text, uuid) from public, anon, authenticated;
revoke all on function public.ledger_update(text, uuid, numeric, text, text, date) from public, anon, authenticated;
revoke all on function public.ledger_delete(text, uuid) from public, anon, authenticated;
revoke all on function public.ledger_clear(text) from public, anon, authenticated;

grant execute on function public.ledger_list(text) to anon;
grant execute on function public.ledger_add(text, numeric, text, text, date, text, uuid) to anon;
grant execute on function public.ledger_update(text, uuid, numeric, text, text, date) to anon;
grant execute on function public.ledger_delete(text, uuid) to anon;
grant execute on function public.ledger_clear(text) to anon;

do $$
declare
  v_key text := 'PASTE_YOUR_KEY_HERE';
begin
  if length(v_key) < 24 then
    raise exception 'Set v_key to a long random key before running this file (see the header).';
  end if;

  insert into public.ledger_config (id, key_hash, updated_at)
  values (1, encode(digest(v_key, 'sha256'), 'hex'), now())
  on conflict (id) do update
    set key_hash = excluded.key_hash,
        updated_at = now();
end $$;

notify pgrst, 'reload schema';
