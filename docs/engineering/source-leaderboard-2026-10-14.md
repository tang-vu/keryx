# All-source dashboard leaderboard

The owner requested separate source rows even when multiple sources share a payout
wallet. The previous dashboard showed only the creator earnings aggregate, so
public references with separately settled Keryx operating fees were absent.

The dashboard now lists active creator sources, retained public feeds, curated
publisher links, public paper metadata and sources from validated settled fee
allocations. Rows use source IDs, never a wallet grouping. Catalog entries with
no recorded activity remain visible. Search filters the complete rendered list;
there is no top-N truncation. Catalog records are discovery metadata, not proof
of publisher ownership, reading, citation, payment or factual accuracy.

Creator rewards and owner operating fees remain separate amounts and counts.
An owner fee is attributed only from its retained original allocation, matched
to a canonical genuinely settled payment, payment/query IDs, beneficiary, amount,
source/marker and exact article URL. Integer micro-USDC shares must sum to the
original amount. One transfer can contribute to several source rows, so row
transfer counts must not be added to infer a global number of transfers.

Only publicly listed originals may provide source associations when privacy
authority is active. Private, unlisted, erased, missing or mismatched originals
make source fee totals unknown, rather than falsely publishing partial all-time
amounts or zeros. No legacy privacy fallback is permitted. The selected fee
network is explicit; old records remain on their original network. Creator
earnings retain the existing all-time, mixed-origin, non-row-partitioned scope.

`GET /api/metrics` adds `sourceLeaderboard`; its existing `leaderboard` and
financial counters keep their creator-earnings semantics. Creator detail and
owner cash-out accounting remain unchanged. Ordinary Supabase source-payment
history now paginates beyond PostgREST's 1,000-row cap and propagates failed
pages. Enrolled storage keeps its existing complete bounded RPC or refusal.
There is no schema migration, settlement replay, new payment, claim, recipient,
budget, credential, schedule or custody change.

Web and the desktop dashboard consume this additive metrics view. API clients
may consume it independently. CLI, remote/stdio MCP, extension and bots retain
their established research/receipt handoffs and creator accounting; this change
does not give those surfaces a new payment authority or alter their contracts.
Version allocation, merged batch delivery and publication belong to ROOT.
