-- Ledger — SMS import add-on
--
-- Run this once in Supabase → SQL Editor after supabase-schema.sql.
-- It adds public.ledger_add_sms(...), which accepts a raw bank SMS and
-- parses the amount, category, merchant and date on the server.
--
-- Endpoint:
--   POST https://<project>.supabase.co/rest/v1/rpc/ledger_add_sms
--   { "p_key": "...", "p_message": "..." }
--
-- Optional fields: p_sender, p_date.
-- Non-expense messages (OTP, credit, refund, declined) return null.

create or replace function public.ledger_add_sms(
  p_key text,
  p_message text,
  p_sender text default null,
  p_date date default null
)
returns public.expenses
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_text text := coalesce(p_message, '');
  v_lower text := lower(coalesce(p_message, ''));
  v_amount_text text;
  v_amount numeric;
  v_merchant text;
  v_description text;
  v_category text := 'Other';
  v_date date := coalesce(p_date, current_date);
  v_date_match text[];
  v_day int;
  v_month int;
  v_year int;
  v_hash text;
  v_id uuid;
  v_row public.expenses;
begin
  if not public._ledger_ok(p_key) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  if btrim(v_text) = '' then
    raise exception 'message is empty' using errcode = '22023';
  end if;

  -- Ignore messages that are not purchases.
  if v_lower ~ '(otp|one[ -]?time password|verification code|do not share|valid for [0-9]+ min)' then
    return null;
  end if;

  if v_lower ~ '(declined|failed|not debited|reversed|cancelled|canceled)' then
    return null;
  end if;

  if v_lower !~ '(debit|debited|spent|paid|payment|purchase|withdraw|withdrawn|sent|txn|transaction|transfer|transferred|imps|neft|rtgs|used at|charged|billed|\mdr\M)' then
    if v_lower ~ '(credit|credited|received|refund|cashback|deposit|salary|\mcr\M)' then
      return null;
    end if;
    raise exception 'no expense transaction found in message' using errcode = '22023';
  end if;

  -- Amount: prefer an amount next to the transaction verb, then any currency amount.
  v_amount_text := (regexp_match(v_text,
    '(?:debited|spent|paid|payment|purchase|withdrawn|withdraw|sent|txn|transaction|transfer|transferred|imps|neft|rtgs|used|charged|billed|\mdr\M)[^0-9]{0,60}(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)',
    'i'))[1];

  if v_amount_text is null then
    v_amount_text := (regexp_match(v_text,
      '(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:debited|spent|paid|payment|purchase|withdrawn|withdraw|sent|txn|transaction|transfer|transferred|imps|neft|rtgs|used|charged|billed|\mdr\M)',
      'i'))[1];
  end if;

  if v_amount_text is null then
    v_amount_text := (regexp_match(v_text,
      '(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)',
      'i'))[1];
  end if;

  if v_amount_text is null then
    v_amount_text := (regexp_match(v_text,
      '(?:debited|spent|paid|payment|purchase|withdrawn|withdraw|sent|txn|transaction|transfer|transferred|imps|neft|rtgs|used|charged|billed|\mdr\M)[^0-9]{0,30}([0-9][0-9,]*(?:\.[0-9]{1,2})?)',
      'i'))[1];
  end if;

  if v_amount_text is null then
    raise exception 'no amount found in message' using errcode = '22023';
  end if;

  begin
    v_amount := replace(v_amount_text, ',', '')::numeric;
  exception when others then
    raise exception 'invalid amount "%": %', v_amount_text, sqlerrm using errcode = '22023';
  end;

  if v_amount is null or v_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  -- Merchant / description.
  v_merchant := (regexp_match(v_text,
    '(?:to|at|towards)\s+(?:vpa\s+)?([a-z0-9@._-]{3,})',
    'i'))[1];

  if v_merchant is not null then
    v_merchant := btrim(v_merchant);
    v_merchant := regexp_replace(v_merchant, '[.,;:]+$', '');
    if lower(v_merchant) in ('your','account','a/c','ac','vpa','the','bank','card','credit','debit') then
      v_merchant := null;
    end if;
  end if;

  v_description := coalesce(nullif(v_merchant, ''), nullif(btrim(p_sender), ''), 'Bank alert');
  v_description := left(v_description, 80);

  -- Category mapping.
  if v_lower ~ '(swiggy|zomato|restaurant|cafe|coffee|food|dominos|pizza|bakery|eatery|bigbasket|blinkit|zepto|grofers|dunzo)' then
    v_category := 'Food';
  elsif v_lower ~ '(uber|ola|rapido|fuel|petrol|diesel|metro|irctc|train|flight|airline|cab|toll|fastag|parking|redbus|makemytrip|goibibo)' then
    v_category := 'Transport';
  elsif v_lower ~ '(netflix|prime video|hotstar|spotify|bookmyshow|movie|cinema|game|steam|playstation|xbox|youtube premium|jiocinema|sonyliv)' then
    v_category := 'Entertainment';
  elsif v_lower ~ '(airtel|jio|vodafone|vi |recharge|electricity|water bill|gas bill|broadband|insurance|premium|rent|emi|dth|postpaid|landline|bescom|mahanagar|bses|tata power)' then
    v_category := 'Bills';
  elsif v_lower ~ '(pharmacy|medical|hospital|clinic|doctor|apollo|pharmeasy|1mg|netmeds|lab|diagnostic|practo)' then
    v_category := 'Health';
  elsif v_lower ~ '(amazon|flipkart|myntra|ajio|meesho|store|mart|mall|retail|decathlon|nykaa|tatacliq|snapdeal|shop|bazaar)' then
    v_category := 'Shopping';
  end if;

  -- Date: use override, otherwise try yyyy-mm-dd or dd-mm-yyyy, otherwise today.
  if p_date is null then
    v_date_match := regexp_match(v_text, '([0-9]{4})[-/]([0-1]?[0-9])[-/]([0-3]?[0-9])');
    if v_date_match is not null then
      begin
        v_date := make_date(v_date_match[1]::int, v_date_match[2]::int, v_date_match[3]::int);
      exception when others then
        v_date := current_date;
      end;
    else
      v_date_match := regexp_match(v_text, '([0-3]?[0-9])[-/]([0-1]?[0-9])[-/]([0-9]{2,4})');
      if v_date_match is not null then
        begin
          v_day := v_date_match[1]::int;
          v_month := v_date_match[2]::int;
          v_year := v_date_match[3]::int;
          if v_year < 100 then
            v_year := 2000 + v_year;
          end if;
          v_date := make_date(v_year, v_month, v_day);
        exception when others then
          v_date := current_date;
        end;
      end if;
    end if;
  end if;

  -- Deterministic id so the same SMS cannot be inserted twice.
  v_hash := encode(digest(v_text, 'sha256'), 'hex');
  v_id := (substr(v_hash, 1, 8) || '-' ||
           substr(v_hash, 9, 4) || '-' ||
           '4' || substr(v_hash, 14, 3) || '-' ||
           '8' || substr(v_hash, 18, 3) || '-' ||
           substr(v_hash, 21, 12))::uuid;

  insert into public.expenses (id, amount, category, description, date, source)
  values (v_id, v_amount, v_category, v_description, v_date, 'shortcut')
  on conflict (id) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.expenses where id = v_id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.ledger_add_sms(text, text, text, date) from public, anon, authenticated;
grant execute on function public.ledger_add_sms(text, text, text, date) to anon;

notify pgrst, 'reload schema';
