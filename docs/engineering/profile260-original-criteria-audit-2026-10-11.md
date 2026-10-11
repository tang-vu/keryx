# Private profile original-criteria audit — 2026-10-11

Relates to [#260](https://github.com/tang-vu/keryx/issues/260).
The ordinary-storage source implementation and existing isolated tests cover
the issue's five written acceptance criteria. The issue remains open because the
enrolled production store does not expose the profile domain. Rebuilding the
profile, authentication or publication system would not resolve that gate.
This audit changes documentation only and grants no storage or rollout authority.

## Source and evidence provenance

[PR324](https://github.com/tang-vu/keryx/pull/324) merged the profile source on
October 9 as `e53a64843a9982bf3349420c765e23d4fd304a18`; its tested head was
`c28a4247332362f14a45156562bffee8b7112425`. The initial October 11 audit examined
`343d10d0db74cfc5be43dc30f8240206b185dac5`, tree
`f67dde609484b7ef473a88463fc176374276943a`. That starting candidate is not a
claim of an accepted main merge or deployment at that capture.

The resumed audit is synchronized to accepted main
`b1b431fd3ed7c8af88682fd5355bd6996a763271`, tree
`8f220af31d309609922f42daa3dcc1956c22c43c`, after PR406/411/414 merged.
All 21 audited profile domain/UI/fixture paths retain their original audited
blobs at this base, so the 93 hosted historical cases below are reused with
their original qualifications. This does not claim a new runtime test or live
profile acceptance. The independent source review accepted the original audit
checkpoint `effd463069c9e69c74333a1779130c5a8722224c` as source only.
Root has frozen b1 for one app0.27.57 delivery; recorded production remains
app0.27.56. This next-batch documentation PR remains subject to root's merge hold
until the app0.27.57 delivery receipt.

The domain schema, owner API handler, SQLite/Supabase profile helpers and original
CRUD/collision tests retain PR324's blobs. Later verified-identity integration
and translated UI copy are already in the current source; those broader files
must not be described as unchanged since PR324. The profile domain/UI/fixtures
audited here also retain the source blobs at recorded production app0.27.56,
commit `437764bf5e47ef342697c04aa16087ae58b700e6`. Source presence there does
not imply that the enrolled backend admits the capability.

The initial candidate's hosted jobs provide applicable historical evidence:

- [Checks, job114496221384](https://github.com/tang-vu/keryx/actions/runs/38148293510/job/114496221384): full app/ops TypeScript and the actual PostgreSQL17 profile migration fixture passed. The fixture records CRUD, 1201-row owner activity, concurrent unique-handle collision, reserved/URL/field refusal, private ACLs, unchanged-history deletion and enrolled refusal.
- [Production, job114496221565](https://github.com/tang-vu/keryx/actions/runs/38148293510/job/114496221565): production builds and the current profile components with built CSS passed; the profile browser fixture covers 320/390/1366 widths, CRUD, plain text, external-link fencing, owner changes, sign-out, unavailable-store privacy and zero outbound requests.
- [Integration, job114496221481](https://github.com/tang-vu/keryx/actions/runs/38148293510/job/114496221481): built stdio MCP profile read/update with a synthetic HTTPS bearer transport passed. It does not establish live backend or fresh installed-service acceptance.
- The three historical [unit shards](https://github.com/tang-vu/keryx/actions/runs/38148293510) passed 93 relevant cases: schema30, route20, client15, MCP6, remote-route5, SQLite7 and Supabase10. The client count includes existing verified-identity read cases; this audit claims no new identity work.

These are successful individual job/step observations at the initial audited
source. At that capture, PR406 was open and its enrolled-Supabase check was
cancelled; that historical run remains cancelled. PR406 subsequently merged on
October 11 at 16:48:37 UTC as `46d265deb520476730d2cdcc4da51bf94cc8781b`,
from final head `efdf7b3ab8af660f017e387334ad02b935b9b27e`. Its later acceptance
does not relabel the earlier run or establish production profile admission.
No build, PostgreSQL fixture, provider trial or global study was replayed for
this documentation audit.

## Original criteria mapped to current code

| Original criterion | Existing implementation and behavior | Evidence and qualification |
| --- | --- | --- |
| Signed-in web create/edit/delete; scoped API/MCP read/update | [`/me/profile`](../../app/me/profile/private-profile-view.tsx) remounts on wallet changes, aborts old requests and withholds stale responses. [`profile-route.ts`](../../lib/profiles/profile-route.ts) selects only active SIWE or verified bearer ownership; cookie mutations require exact Origin and an expected-wallet comparison. Invalid bearer presence never falls back to cookies. Explicit `profile:read` and `profile:write` do not imply each other. Remote and stdio MCP share [`profile-mcp.ts`](../../lib/profiles/profile-mcp.ts). | [`profile-route.test.ts`](../../lib/profiles/profile-route.test.ts), [`profile-remote-route.test.ts`](../../lib/profiles/profile-remote-route.test.ts), [`profile-mcp.test.ts`](../../lib/profiles/profile-mcp.test.ts), [`profile-client.test.ts`](../../lib/profiles/profile-client.test.ts), built browser and stdio fixtures passed. Synthetic sessions/transports are not deployed SIWE/key acceptance. |
| Profile absent from every public response until published | Profile rows have a separate non-enumerable optional DB port. Only authenticated owner API and explicitly scoped MCP operations read it. The public activity, metrics, creator, usage, dispatch/receipt and research-export paths do not join `private_profiles` or invoke that port. Supabase table/RPC access is denied to anon/authenticated roles. Tool discovery and OpenAPI describe fields without returning private values. No public profile lookup or publish operation exists in this domain. | Current read-path trace, MCP discovery/auth refusal tests, PostgreSQL ACL fixture and browser wallet-switch/sign-out tests support this boundary. This is source/fixture evidence, not an exhaustive deployed public-response capture. Future publication belongs to #264 and must preserve visibility checks; it is not necessary to keep #260 private. |
| Case-insensitive unique/reserved handles in both adapters | [`private-profile.ts`](../../lib/profiles/private-profile.ts) trims/lowercases handles and rejects all reserved names before adapter I/O. SQLite uses transactional upsert plus a UNIQUE handle constraint; [`0083_private_profiles.sql`](../../supabase/migrations/0083_private_profiles.sql) uses the same lower-case ASCII/reserved constraints and a PostgreSQL unique index. Noncanonical direct SQL values refuse instead of occupying a second case variant. Collisions reveal no other owner. | [`private-profiles-sqlite.test.ts`](../../lib/db/private-profiles-sqlite.test.ts) tests case variants, retained loser fields and released handles. [`private-profiles-supabase.test.ts`](../../lib/db/private-profiles-supabase.test.ts) tests bound RPC calls and collision errors. Actual PostgreSQL separate-process contention and reserved-name refusal passed. |
| Free text length-bounded and rendered as text, never markup | Display name is bounded to 80 UTF-16 units, bio/purpose to 160; controls, formatting controls and invalid surrogates refuse. React input values render text. Literal HTML-looking text is permitted as data; the original criterion does not require stripping it. Links use bounded allowlisted HTTPS URLs and are never fetched or used as identity authority. | Shared-schema refusal tests, PostgreSQL text/URL rejection, and the actual component fixture's malicious `<img>` input with zero injected DOM elements passed. No `dangerouslySetInnerHTML` profile rendering exists. |
| Create/edit/delete/collision/adapter parity tests | SQLite and Supabase share the input/record/activity schemas and owner port. SQLite exercises actual local transactions; Supabase tests strict RPC acknowledgement, owner/network parity and no REST fallback, supplemented by execution of the real SQL migration in isolated PostgreSQL. | The adapter fixtures compare derived whole-store counts/topics and settled creator-payee filtering. Delete tests retain account, run and payment rows byte-for-byte. No claim of native/enrolled CRUD parity is made: those adapters intentionally refuse the unsupported capability. |

The input contract rejects derived activity, wallet selectors, visibility, role
and `payTo`. User assertions remain separate from first-seen, recorded surfaces,
question count, topics and creator-payee counts. Activity describes attributed
current-store rows, excludes anonymous/archive history, and does not infer the
funding identity. Recorded payment evidence is not independent reconciliation.

## Applicable surfaces and role boundaries

| Surface | Profile behavior and remaining gate |
| --- | --- |
| Web / hosted API | Existing private owner editor and GET/PUT/DELETE route; availability depends on the selected store. Enrolled production requires domain admission before CRUD can work. |
| Remote MCP | Existing verified-key actor/scopes authorize read/update. Profile-only keys do not acquire research authority; mixed research batches refuse. Uses the same backend capability gate. |
| CLI / stdio MCP | Existing bearer client uses the fixed HTTPS owner endpoint, bounded no-store requests, no redirects/write retries or signer loading. The built package fixture passed; root must verify the released package and real admitted backend before delivery claims. |
| Desktop | Hosted authenticated web handoff; no independent local profile store or native mutation capability. Root owns coordinated installer/package/source identity verification. |
| Extensions, bots, OpenAI/A2A research, exports and receipts | Intentional research roles carry no profile fields or implicit profile scopes. They neither publish private fields nor infer source/payout authority. No new identity connection or user-facing action was performed. |

Verified identity #265, public publication #264 and ownership/history #261/#262
remain separate outcomes. The owner-selected #266 policy makes all historical
runs unlisted, new authenticated owned runs private by default with explicit
owner publication, and new anonymous/unowned runs unlisted until proven ownership.
That policy is source only; shared production DDL/backfill and live activation
remain held. It does not publish profile assertions or infer ownership of old
runs. This audit preserves those separate source and delivery boundaries.
Profile deletion can remove profile-linked identity metadata through existing
domain foreign keys; it cannot rewrite original payment or settlement records.

## Concrete remaining delivery gates

1. Main synchronization is satisfied at b1. This focused documentation PR still
   requires its own actual prose-lane aggregate and applicable checks; the
   historical runtime evidence above is not this PR's CI acceptance. Root owns
   review and merge, and holds next-batch merges until the app0.27.57 delivery
   receipt. Documentation/source acceptance cannot activate the profile domain.
2. A separately reviewed profile-domain admission must cover the actual enrolled
   SQLite/native or Supabase backend: schema/identity/provenance, bounded method
   authority, private ACLs, atomic collisions, ownership and history-preserving
   deletion. Installing ordinary migration0083 into shared production or adding
   a fallback would bypass the current refusal. This audit authorizes neither.
3. Root obtains the required production admission/activation authorization and
   performs the controlled rollout with existing custody, payment, schedule,
   backup and rollback boundaries. No profile activation is inferred from a
   general application deployment.
4. After admission, verify actual deployed SIWE create/edit/delete and explicitly
   scoped API/remote-MCP/stdio read/update; cross-owner, revoked-key, stale-editor,
   collision, private public-response and unchanged-history cases must succeed.
   Verify applicable released package/installer/host identities as part of the
   same delivery. Existing synthetic fixtures do not satisfy this gate.
5. Root assesses the original issue against that delivered evidence. Until then
   #260 remains open, with source criteria evidenced and production CRUD held.

The source-only boundary is documented in
[private profiles](private-profiles-2026-10-09.md),
[verified identities](private-verified-identities-2026-10-09.md), and the
[original-issue audit](issue-closure-audit-2026-10-10.md).
