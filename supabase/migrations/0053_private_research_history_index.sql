-- Owner-only keyset history. Existing table RLS and service-role privileges remain intact.
create index if not exists private_research_intents_history
  on public.private_research_intents(payer, created_at desc, id desc);
