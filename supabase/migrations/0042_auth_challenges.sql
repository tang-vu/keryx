-- Server-issued, expiring, single-use SIWE challenges. Only hashes are retained.
create table if not exists public.auth_challenges (
  hash text primary key check (hash ~ '^[a-f0-9]{64}$'),
  issued_at bigint not null check (issued_at >= 0),
  expires_at bigint not null check (expires_at > issued_at and expires_at <= issued_at + 300000)
);
create index if not exists auth_challenges_expiry on public.auth_challenges(expires_at);
alter table public.auth_challenges enable row level security;
revoke all on table public.auth_challenges from public, anon, authenticated;
grant all on table public.auth_challenges to service_role;

create or replace function public.create_auth_challenge(p_hash text, p_issued_at bigint, p_expires_at bigint)
returns void language plpgsql security invoker set search_path = public as $$
begin
  delete from public.auth_challenges where expires_at <= p_issued_at;
  insert into public.auth_challenges(hash, issued_at, expires_at) values (p_hash, p_issued_at, p_expires_at);
end;
$$;

create or replace function public.consume_auth_challenge(p_hash text, p_now bigint)
returns boolean language plpgsql security invoker set search_path = public as $$
declare
  affected integer;
begin
  delete from public.auth_challenges where hash = p_hash and issued_at <= p_now and expires_at > p_now;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.create_auth_challenge(text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.consume_auth_challenge(text, bigint) from public, anon, authenticated;
grant execute on function public.create_auth_challenge(text, bigint, bigint) to service_role;
grant execute on function public.consume_auth_challenge(text, bigint) to service_role;
