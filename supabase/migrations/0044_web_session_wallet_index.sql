-- Account session listing and wallet-scoped revocation. Existing private privileges remain.
create index if not exists web_sessions_wallet on public.web_sessions(wallet, expires_at);
