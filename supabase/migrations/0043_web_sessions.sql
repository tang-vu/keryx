create table if not exists public.web_sessions (
  hash text primary key check (hash ~ '^[a-f0-9]{64}$'),
  wallet text not null check (wallet ~ '^0x[a-f0-9]{40}$'),
  issued_at bigint not null check (issued_at >= 0),
  expires_at bigint not null check (expires_at > issued_at and expires_at <= issued_at + 604800000)
);
create index if not exists web_sessions_expiry on public.web_sessions(expires_at);
alter table public.web_sessions enable row level security;
revoke all on table public.web_sessions from public, anon, authenticated;
grant all on table public.web_sessions to service_role;

create or replace function public.create_web_session(p_hash text, p_wallet text, p_issued_at bigint, p_expires_at bigint)
returns void language plpgsql security invoker set search_path = public as $$
begin
  delete from public.web_sessions where expires_at <= p_issued_at;
  insert into public.web_sessions(hash,wallet,issued_at,expires_at) values (p_hash,lower(p_wallet),p_issued_at,p_expires_at);
end;
$$;
revoke all on function public.create_web_session(text,text,bigint,bigint) from public, anon, authenticated;
grant execute on function public.create_web_session(text,text,bigint,bigint) to service_role;
