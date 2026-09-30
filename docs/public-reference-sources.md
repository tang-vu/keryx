# Free public reference sources

Keryx can research publicly published RSS bodies alongside verified creator sources.
Public references are free evidence: they carry no publisher wallet, feed ownership
verification, registry registration, access toll, or citation reward. Public availability
does not establish an agreement with the publisher or authorize Keryx to monetize their
writing. Existing verified creator sources keep their payment and registry authority.

The initial approved batch contains Cloudflare Workers, Chip Huyen, Lilian Weng and
Vicki Boykis. Official Circle RSS candidates returned 404 during the September 30
endpoint audit and are deferred. No feed wrapper or publisher authorization is invented.
Publication dates come from the publisher; older foundational articles are not labeled
recent because they were just collected.

## Storage and reads

SQLite `public_references` stores a separate validated snapshot of at most ten latest
feed entries per reference. It has no payout fields. Refresh replaces that snapshot,
deduplicates canonical HTTPS article links and preserves feed-provided delivery labels.
The importer and upkeep use the existing DNS-pinned public-address fetch transport:
500,000 bytes, 12 seconds and at most three redirects. They fetch the feed only, never
follow article links, circumvent paywalls, purchase content, encrypt it as owned paid
content, pin it remotely, or invoke an LLM.

Discovery selects one relevant feed item per source and captures its exact body,
canonical link, publisher date and version before reasoning. Model proposals cannot
change its free price or enable payment. A public-only portfolio never invokes wallet
funding or a deposit; an owned source admitted during expansion funds only at that boundary. Public reads share the same claim-target and
attention portfolio as paid reads. The existing model context selector scans at most
200,000 characters and supplies at most 2,000 selected passage characters per source;
the candidate preview is limited to 600 characters. A refresh during a run cannot replace
its captured evidence. A feed excerpt remains an excerpt, not an inferred full article.

Exact quotes, declared answer markers and minimum support govern answer eligibility
(`qualifiesForAnswer`). Public evidence always has `qualifiesForReward=false`.
Attribution allocates the original contribution weights in integer micro-USDC, then
withholds public shares: owned weights 40% and 10% with a public 50% share pay those
owned shares, never an inflated 80% and 20%. Public citations and portable receipts
identify free provenance; no fake payment row or settled traction is recorded.

Reserved `public:` IDs cannot be persisted as paid sources or resolve payment terms.
The source, article and citation toll endpoints reject them before database or settlement
work. Public evidence is not put in paid decrypted caches. Supabase public catalog reads
return no entries and writes fail closed; deploying public catalogs on that adapter
requires a separate schema and acceptance review.

## Import and ongoing upkeep

After deploying the reviewed commit to the SQLite host:

```powershell
npm run import:public-references
npm run import:public-references -- --apply
```

The first command lists the fixed approved batch without network or writes. `--apply`
fetches each of the four feeds sequentially and idempotently upserts its snapshot.
It outputs publisher names, success state and item counts only; any failure sets a
nonzero exit status while preserving other successful entries. Existing deactivation
is preserved. This explicit initial onboarding never resets or bypasses the recurring
hourly journal. `/sources` renders current database state on each request so the imported
catalog is immediately inspectable; verify all four entries before reporting live success.

Scheduled upkeep uses one atomic allowance and round-robin cursor across BOTH catalogs:
at most two feeds and twenty candidates per hour, with the existing 45-second job deadline
and eligibility/URL recheck before writes. The Worker is unchanged. With thirteen
verified feeds and four public references, a stable combined pool requires nine hourly
batches to visit each source. The combined bounds remain 48 feed fetches and at most
480 candidates per day. A failed or interrupted slot stays consumed.

## Acceptance and rollback

Focused tests cover free-only and mixed runs, malicious BUY proposals, shared attention,
original weighted shares, weak/noncited public evidence, direct toll refusal, immutable
versions and bounded context, separate SQLite persistence, fixed-batch idempotency,
combined upkeep fairness and late-fetch write refusal. TypeScript, lint, the production
build, full tests and required CI are release gates. Local checks do not establish live
publisher cooperation, independent usage, settled revenue or research quality.

To remove a public reference, preserve its snapshot but set `active=false` using the
validated SQLite catalog interface. This removes it from discovery and scheduled upkeep;
past run snapshots and receipts remain honest historical evidence. Reverting this release
leaves the isolated table dormant and does not change creator payment records.
