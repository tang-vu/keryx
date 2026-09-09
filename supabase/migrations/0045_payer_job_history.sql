create index if not exists a2a_orders_payer_history on public.a2a_orders(lower(payer), created_at desc, id desc);

create or replace function public.list_a2a_orders_for_payer(
  p_wallet text, p_before_created_at timestamptz default null, p_before_id text default null
) returns setof public.a2a_orders
language sql stable security invoker set search_path = public as $$
  select * from public.a2a_orders
  where lower(payer) = lower(p_wallet)
    and ((p_before_created_at is null and p_before_id is null)
      or (p_before_created_at is not null and p_before_id is not null
        and (created_at < p_before_created_at or (created_at = p_before_created_at and id < p_before_id))))
  order by created_at desc, id desc limit 26;
$$;
revoke all on function public.list_a2a_orders_for_payer(text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.list_a2a_orders_for_payer(text,timestamptz,text) to service_role;
