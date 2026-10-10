# Recorded public usage — issue 249

This source outcome connects the existing audit reducer to ordinary database storage.
`/usage` and `/api/usage` show outside, team, scripted and unknown columns separately.
They describe recorded evidence, not independently observed production traction.
The classified view is unavailable on native/sealed adapters. Migration 0089 is source
only until ordinary PostgreSQL acceptance and a separately authorized rollout qualify it;
it must not be applied to enrolled storage or a shared production database by this task.

## Classification and funding

The shared `runAgent` public completion stamps a closed versioned usage snapshot for
all web, API, remote/stdio MCP, CLI, extension, desktop and bot paths that use it.
Private originals keep their existing shape. Controlled evaluation/demo harnesses and
the authenticated bot ingress supply a server-local scripted token. A configured team
wallet requires existing verified ownership provenance. Everything else defaults to
unknown. An execution channel, IP, client name, question, header or public request option
does not identify an outside user or supply funding evidence.

Configured team membership establishes only the actor. Its funding stays unknown until
a separate reviewed funding fact/digest exists. Unknown, independent or sponsored
caller facts do not manufacture team funding; a team/treasury funding label itself
requires a separate retained digest even for team or scripted actors.

The token lives in a module-private WeakMap; serialized or forged public objects do not
qualify. An outside actor needs a retained evidence digest; independent, sponsored or
treasury/team funding requires a separate digest. No active ingress in this source
outcome invents those facts. Future outside-evidence issuers need review. Outside-user
sponsored payments and outside-user treasury payments are separate from independent
outside payers. A scripted label alone does not prove team funding.

Absent or malformed historical usage remains unknown without rewriting stored rows.
Legacy network attribution requires every recorded payment row for that run to agree
on one canonical Arc network. Unpaid, mixed-network or noncanonical legacy rows are
reported as unattributed rather than relabelled. Distinct verified wallet actors are
not a measurement of distinct humans; anonymous/unverified identities do not add people.

## Window and payment rules

Each query selects exactly `eip155:5042` or `eip155:5042002`, all time, rolling 7/30 days,
or `?since=YYYY-MM-DD` UTC midnight. Run creation is inclusive at since and exclusive at
the captured server until. Settled rows are attributed to runs in that interval; this
does not reconstruct settlement-time history. One complete metadata window is limited
to 10,000 runs, 50,000 payment rows and 8 MiB. Overflow, missing RPC/schema, wrong binding
or malformed evidence refuses figures rather than reporting a partial sample as complete.
The public projector selects the reducer's fixed public-window profile using those same
collection constants. Other audit consumers keep their 2,000-row defaults; callers cannot
supply arbitrary maxima. The public window must also fit the unchanged 8 MiB limit.

Money uses exact integer micro-USDC. Positive recorded rows must have unique IDs,
`settled=true`, `settlementStatus=settled` and a settlement reference. Pending, simulated,
zero-value, fractional-micro and unproved legacy rows are excluded. PostgreSQL numeric
amounts travel as decimal strings to prevent JSON number rounding. This performs no new
chain scan or settlement. Creator counts use qualifying fetch/citation payees.

Deliverable acceptance and median first-answer time are unmeasured, not inferred from
completion, feedback or total duration. No outcome is presented as observed merely
because a source fixture passes.

## History and storage boundaries

`/api/runs?cohort=outside` selects only outside runs in the current classified storage
profile; archives are explicitly excluded from this window. The default hides scripted activity.
Supported ordinary stores classify/filter the whole finite metadata window **before**
selecting the bounded history page. SQLite uses one read transaction. Supabase selects
the page from one RPC snapshot, then rechecks later body identity/time/cohort; body reads
are not claimed to share that snapshot. Only selected public run bodies are loaded.

Without that capability, explicit cohort/network/period filtering returns unavailable.
The default compatibility reader preserves PR296's current/archive merge and
`X-Keryx-Testnet-History` availability header. Current records win duplicate IDs before
known scripted records are hidden; historical unknown/unpaid rows remain visible with
their archive profile. It uses separate finite current/archive 50-row scans and declares
incomplete coverage; it cannot establish a complete outside/network/period page.
`?archive=testnet` selects only the unchanged guarded archive recent reader, labels its
fixed testnet profile and incomplete scanned coverage, and never reads the current store.
Unsupported archive cohort/time-window filters refuse rather than claiming a complete
filtered page. Historical testnet archives retain their original profile and reader.
Existing `/api/metrics` totals are labelled mixed all-origin/all-time figures and point to
the classified endpoint; they are not independent outside-user traction.

The capability is added only to ordinary SQLite/Supabase constructors. Existing native
inventory, schema, identity, enrolled constructors and authority are unchanged. The
ordinary PostgreSQL function is stable/read-only, bounded, service-role-only, and refuses
either native marker before installation and at query time. No application DB init,
DDL/backfill or private/account-history change occurs during public usage reads.

## Acceptance and remaining gates

Literal issue acceptance is implemented in source: write-time tags, default/ outside-only
history, single-network UTC windows and rules, funding separation, conservative unknown
history, and classification/storage tests. The dedicated PostgreSQL17 workflow creates
one owner-labelled network-isolated fixture, retains full raw command receipts and checks
SQL/JS projection, ACL, native refusal, completeness above 2,000 for both run and payment
collections, all caps and unchanged original-row SHA256. That workflow must actually
succeed; source authoring is not SQL acceptance.

Normal source review, hosted aggregate/production-build gates and coordinated runtime
distribution remain required. This outcome is not full deployed issue closure while the
classified capability is absent from the active native/sealed production profile. It
does not authorize a rollout, evidence issuer, production history rewrite, shared DDL,
funding/spending, custody, provider execution or schedules.
