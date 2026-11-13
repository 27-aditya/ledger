-- Ledger — equal split add-on
--
-- Run this once in Supabase → SQL Editor after supabase-schema.sql.
-- It adds expenses.split_count and updates ledger_add/ledger_update to store it.
-- Safe to rerun. It does not change your ledger key or delete any rows.

alter table public.expenses
  add column if not exists split_count integer not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'expenses_split_count_check'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_split_count_check
      check (split_count between 1 and 100);
  end if;
end $$;

drop function if exists public.ledger_add(text, numeric, text, text, date, text, uuid);

create or replace function public.ledger_add(
  p_key text,
  p_amount numeric,
  p_category text default 'Other',
  p_description text default '',
  p_date date default current_date,
  p_source text default 'shortcut',
  p_id uuid default null,
  p_split_count integer default 1
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
  if p_split_count is not null and (p_split_count < 1 or p_split_count > 100) then
    raise exception 'split count must be between 1 and 100' using errcode = '22023';
  end if;

  insert into public.expenses (id, amount, category, description, date, source, split_count)
  values (
    coalesce(p_id, gen_random_uuid()),
    p_amount,
    coalesce(nullif(trim(p_category), ''), 'Other'),
    coalesce(p_description, ''),
    coalesce(p_date, current_date),
    coalesce(nullif(trim(p_source), ''), 'shortcut'),
    coalesce(p_split_count, 1)
  )
  on conflict (id) do nothing
  returning * into v_row;

  return v_row;
end;
$$;

drop function if exists public.ledger_update(text, uuid, numeric, text, text, date);

create or replace function public.ledger_update(
  p_key text,
  p_id uuid,
  p_amount numeric,
  p_category text,
  p_description text,
  p_date date,
  p_split_count integer default null
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
  if p_split_count is not null and (p_split_count < 1 or p_split_count > 100) then
    raise exception 'split count must be between 1 and 100' using errcode = '22023';
  end if;

  update public.expenses
  set amount = p_amount,
      category = coalesce(nullif(trim(p_category), ''), category),
      description = coalesce(p_description, ''),
      date = coalesce(p_date, date),
      split_count = coalesce(p_split_count, split_count)
  where id = p_id;

  return found;
end;
$$;

revoke all on function public.ledger_add(text, numeric, text, text, date, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.ledger_update(text, uuid, numeric, text, text, date, integer) from public, anon, authenticated;

grant execute on function public.ledger_add(text, numeric, text, text, date, text, uuid, integer) to anon;
grant execute on function public.ledger_update(text, uuid, numeric, text, text, date, integer) to anon;

notify pgrst, 'reload schema';
