# ORIGINAL268 private-history API-client / CLI / MCP source partition — 2026-10-14

This is NEXT source work in the SAME original268 completed-private-history outcome.
**All new cancellation fixtures are UNRUN by the repair author.** No original268 closure, new version,
published artifact, installed tool or production delivery is claimed.
Worktree HEAD remains `ae298ff41c239b292a043b3442df33f1701a4b99`;
The R82 capture observed local `origin/main` at `866acfa7ef3e95774321fc53576cfa08fe1cf2f6`;
the supplied review later observed `76106089a78989d04aeb50f67a9d76241746d6f5`.
Delivered64/main/production are outside this author's writes.

Read canonical and local AGENTS/override, current origin/main coordination and
development workflows, local pilot common rules, planning/review skills and
gateway-spend/demo-critical/verified-invariants references. Both skills are
readable in this worktree and present in this session catalog. R79's
`source-handoff.md` and R80's `source-review.md` under ROOT's
`output/resume-root-release63-20261012/refill-successors-20261013-79/80`
were read. The existing completed reader's parent-reported **46 meaningful PASS**
and the source-reviewed API contracts are prior evidence, not newly executed
checks in this partition.

## SDK cancellation repair - 2026-10-14

The supplied focused review found one reachable P2: the three new callbacks
discarded the pinned SDK's `extra.signal`, and the stdio wrappers omitted the
HTTPS client's supported `options.signal`. SDK 1.31.0's actual local
`shared/protocol.js` aborts the request controller for `notifications/cancelled`
and connection close, passes its signal to the handler, and suppresses cancelled
replies. `server/mcp.js` awaits validation before calling `(args, extra)`.
Those actual sources and declarations were read without loading any module.

All three callbacks now refuse an already-aborted signal before dispatch,
forward it through list/detail/export options and check it again synchronously
after the lifetime fence before private text/structured output. Stdio forwards
those options to its existing lazy key-only client. The HTTPS client additionally
refuses a pre-aborted call before reading or binding the key. Its existing
controller, bounded body reader, late-response cancellation and 15/25-second
deadlines handle cancellation without a retry or another request.

Remote registration passes the same call signal into the existing bounded read
helper. That helper listens to both the per-call SDK signal and the captured
original HTTP signal, without changing either signal or any actor/key ID/scopes/
verifier snapshot. Its existing cancellation race stops admission while the
original verifier or Db acquisition is awaiting, prevents the next private IO,
and aborts the signal passed to the existing reader/export. Verifier/Db APIs do
not expose cancellation ports; their already-started promises may finish, but
their late completion cannot advance the cancelled pipeline. The ORIGINAL
verifier still runs before getDb, after getDb before private IO, and after the
read/guards. The synchronous current-access output fence remains. UNKNOWN
provenance, NULL money, body bounds, ownership and all old tools remain intact.

New UNRUN fixtures use actual SDK Client/McpServer/InMemoryTransport messages:
pre-dispatch cancellation for all three tools has zero key/fetch IO; cancellation
during HTTPS or a partially read body aborts the underlying signal/stream;
late bodies are cancelled; manual export, connection close and the final output
fence suppress private output without retry. Existing key/owner negatives are
also exercised through the forwarded signal. Actual remote registration covers
cancellation during original verification, Db acquisition, post-Db verification,
post-read verification and export IO, including independent original HTTP abort.
No new fixture was run by this author.

ROOT reports the prior focused run as **105 cases, 104 PASS and one CLI table
arity failure**. That is prior parent evidence only. ROOT concurrently owns the
disjoint CLI table correction and the HTTP/package discovery assertions; this
repair changes none of those files. Next ROOT checks are the changed client/MCP/
remote fixtures and corrected CLI fixture, root/ops and independently installed
MCP types, current build, DIFFERENT focused security review, and the focused PR's
required aggregate/domain/platform CI. Exact-source clean-package discovery,
new-tool refusal/cancellation acceptance and package/desktop/extension publication/
installation provenance still gate delivery. Published MCP 0.4.20 contains none
of these new tools. Original #268 remains OPEN; production AE64, main and versions
are outside this repair.

The R82 pins/inverse tables below are retained as historical before-repair proof.
Current eight-path whole before/after images, raw pins, minimal patch and exact
whole-before inverse are in ROOT's assigned R86 output under
`worker-repairPrivate268McpCancellation/source-repair/verified/`, with original
before images in the adjacent `source-repair/before/`. They prove this repair
only; combined-source acceptance belongs to ROOT. No compiler/test/module/app/
build/producer/DB/provider/target/DDL/spend/ENV/activation/Git writer was executed.

## Existing contract and actual callers

The new [shared key-only client](../../lib/history/private-job-history-client.ts)
uses only the EXISTING exact HTTPS POST contracts:

| Action | Endpoint | Body | Output |
| --- | --- | --- | --- |
| list | `/api/me/private-jobs` | Shared strict filters, default limit 25 | Shared page envelope |
| detail | `/api/me/private-jobs/detail` | Strict `{id}` | Shared private detail envelope; missing ID refuses |
| export | `/api/me/private-jobs/export` | Shared strict filters plus `format:"json"` | Shared bounded metadata export envelope |

Private IDs, search terms and cursors remain in bodies. There is no body/query
owner selector. `x-keryx-expected-wallet` is only a precondition and never
authenticates. The first validated server envelope supplies the client lifetime's
owner binding; no wallet from buyer/user configuration is inferred to own a key.
The server authenticates the exact key and enforces explicit `history:read`.
The client checks its captured key before/after transport, every awaited body
read, parsing and caller publication. A changed/removed key cannot reuse the
client lifetime; starting a new credential lifetime requires a new client.

The origin must be a bare HTTPS origin without credentials, path, query or
fragment. Requests omit cookies, refuse redirects, use no-store/no-referrer and
JSON Accept/Content-Type, and never retry. Responses require successful
nonredirected same-endpoint transport, compatible JSON MIME, finite declared and
actual decoded byte bounds, fatal UTF-8 decoding, JSON and the shared schemas.
Timeout/abort races even an injected transport/body that ignores cancellation;
late response bodies are cancelled. Bounds are the existing 8 KiB request,
1,500,000-byte page/detail, 2 MiB export, 15-second reads and 25-second exports.

Plain-data copying before output schema parsing rejects accessors, cycles,
malformed Unicode, nonportable values, excessive depth/counts and byte overflow.
It permits the contract's 500 export rows. Pages check exact envelope/row owner,
requested row/scan counts, unique decreasing durable intent positions, literal
question/surface/network/date filters and continuation consistency. Detail checks
the exact requested ID, owner, intentional NULL list timestamp and saved claim
mapping. Exports check the same rows/filters plus finite pages/rows and truthful
complete/truncated/nextCursor relationships. Cursor alphabet/repetition checks
are transport fences; the existing reader supplies owner/query/upper/before
semantic validation. No transaction snapshot or unlimited archives are promised.

Missing historical provenance remains NULL/unknown. Own settled spend, creator
rewards and paid creators stay strictly NULL. Incoming original settlement is
separate, with its source and independently unverified chain finality. Recorded
citation rewards remain attribution. No signed price or aggregate becomes
creator settlement or own source spend.

## CLI and serialization

[scripts/private-job-history.mts](../../scripts/private-job-history.mts) actually
calls the [testable CLI adapter](../../lib/history/private-job-history-cli.ts).
It accepts list/detail/export, sole `--help`, finite strict filter flags,
detail-only `--id`, export-only json/csv format and the optional expected-wallet
precondition. Unknown/duplicate flags, invalid/reversed dates, unbounded limits
and owner/key/origin selectors refuse before transport. The CLI uses fixed
`https://keryx.cc`, obtains only inherited `KERYX_API_KEY`, and loads no envfile.
The sole ops-config change includes this new entry.

Stdout is explicitly **private data for its authenticated caller**. Detail is a
deliberate private answer read, with no public report/share link or automatic
model submission. Metadata exports require a manual command; neither JSON nor
CSV includes answers or authorization transports. CSV uses the shared export
schema, the same metadata/field order as the existing server serializer, quoted
cells and formula escaping after whitespace/BOM; NULL money is blank. It has a
finite 2 MiB output bound. The existing server serializer stays server-only:
its storage/payment dependency graph is incompatible with a key-only CLI.
A new UNRUN equality fixture compares both serializers. No alternative domain
schema is introduced.

Errors are constant and secret-free; raw argv, response bodies, tokens, cursors,
provider errors and URLs are never reported or logged. No new client telemetry,
source fetch, search/model call, signer, research/purchase path, private DB
fallback or storage mutation is present.

## Remote and stdio MCP

[registerPrivateJobHistoryTools](../../lib/history/private-job-history-mcp.ts)
registers exactly `history_private_jobs_list`,
`history_private_jobs_detail` and `history_private_jobs_export`.
They are finite read-only tools with shared guarded structured output and generic
refusal. Detail is explicit owner read; export is bounded JSON metadata only.
The SDK's object-schema discovery/output normalization cannot use outer ZodEffects.
The adapter uses the same underlying shared object fields, retains every shared
refinement in its guards, and wraps only invalid-input errors with constant copy.
Original optionality and finite discovery bounds remain; an authored fixture
compares generated input schemas to the original shared object schemas.
This is not a second domain contract.

The minimum new `createPrivateJobHistoryRead` partition captures the ORIGINAL
verified `access.actor`, history scopes, key ID, signal and
`access.revalidateHistoryAccess`. It requires actor + explicit `history:read`
+ original revalidator before any Db acquisition. It invokes that original
revalidator **before getDb**, **again after getDb and before private reading**,
and **after the asynchronous read and its guards before output**. Captured
actor/scope content/scope object/key ID/revalidator/signal replacement, abort or
deadline refuses; detectable revocation during Db await has zero private read.
Revocation during the reader suppresses output. The original HTTP closure in
`app/mcp/route.ts` supplies exact live key-ID/wallet/scope checks and retains the
credential privately. No cookie, alternate key or public selector is a fallback.
A synchronous current-access fence also runs at new-tool publication.

[Remote registration](../../lib/mcp/remote-server.ts) passes only the existing
exact-payer completed reader's five READ ports through that new partition.
The old `ownedHistoryRead` body and every old remote tool/auth/payment/role are
preserved. No remote subscription, provider event/webhook or host lifecycle
change is added.

[Stdio registration](../../mcp/keryx-mcp-server.mts) lazily creates one lifetime
of the same key-only HTTPS client at the existing configured HTTPS origin.
A missing key or incompatible origin refuses the new tools without preventing
old tool discovery. It never supplies the buyer wallet as an expected owner.
Stdio's existing buyer setup, paid tools and configuration stay separate.
[mcp/README.md](../../mcp/README.md) is additive source usage only: **published
0.4.20 does not contain these tools yet**. No unborn version/URL is supplied.

## Supported roles and remaining surface acceptance

| Surface | This source partition / remaining gate |
| --- | --- |
| Web/API | Existing source-reviewed POST contracts and R79 owner webpage. R81 separately owns logout invalidation, page headers and pure schema-ID/cursor import extraction; this writer edits none of them. Parent requires corrected DOM/auth/HTTP/browser/Next acceptance. |
| CLI | Actual manual key-only entry/adapter, strict bounded flags, private stdout, JSON/CSV metadata. Parent must run focused client/CLI cases and ops types. |
| Remote MCP | Actual new registration with original verified access and three fresh admission fences; existing tools unchanged. Parent runs focused caller/revocation/structured-output checks and actual HTTP discovery. |
| Stdio MCP / MCP desktop clients | Actual source tool discovery through the inherited explicit API-key role. Claude/Desktop or another MCP desktop client receives the same owner-private responses only with its own history-scoped key; it may retain them. Packed clean-install discovery, compatible object schemas, bounds/revocation/refusals and exact source/publication identity remain required. |
| Keryx native Operator desktop | Its existing pinned stdio task helper remains local inspection/recovery/export; the shell does not request an account key. This partition edits or executes no Rust/helper/App54/native role. It makes no claim that this shell gains private account browsing. Parent retains exact-source package/standard-user install acceptance where the final combined graph requires it. |
| Extension | Browser handoff to `/me/private-jobs` for a fresh verified wallet owner is the permitted private-history role. Current source manifest is 0.1.4.2. This partition changes no extension payload/version and does not assert a new popup handoff was wired; parent must check its actual current-version handoff and source/ZIP/installed provenance under the existing extension checklist. Device public-report history is not private account history. |
| Telegram/Discord/Slack bots | Direct users to the authenticated browser workspace `/me/private-jobs`; this documentation adds no bot command. A signed platform message/chat label proves no wallet/key/private right. Durable verified linkage/revocation/isolation under #263, private-delivery controls and actual command/vendor acceptance remain open before private bot actions can exist. |
| A2A / OpenAI | Existing exact-payer result/purchase/public projections remain unchanged. This source caller reads the dedicated key-authenticated API; it neither turns private detail into public research nor sends it to a model. Any further adapter remains an explicit original268 gate. |

## New behavioral fixtures — ALL UNRUN

| File | Authored behaviors for parent validation |
| --- | --- |
| `private-job-history-client.test.ts` | Actual list/detail/export POST wiring, URL/body separation, HTTPS/explicit-key/strict input refusal, expected-wallet precondition, owner lifetime, key change during transport/body, single-attempt HTTP refusals, MIME/declared/actual bytes/fatal UTF-8/JSON, timeout/abort, filters/intent order/NULL money/claim mapping/getters/truncation and server-CSV equivalence. |
| `private-job-history-cli.test.ts` | Actual adapter help/list/detail/json/csv, fixed origin, strict/duplicate/unknown flags, zero-IO invalid/missing-key/pre-abort, private stdout and generic secret-free transport errors. |
| `private-job-history-mcp.test.ts` | Three finite discovered tools, identical generated shared input schemas, valid guarded list/detail/export, absent detail, unknown/secret-bearing argument refusal, malformed/foreign/oversized/false-truncation output, stdio shared-key bridge, final fence; original revalidation order and absent/expired/revoked/replaced access during Db/read/timeout. |
| New `remote-server.test.ts` partition | Actual remote registration via in-memory MCP and established binding spies; real three reader dispatches, original three fences, zero private/Db/research/provider IO for absent/aborted/revoked access, revoke during Db/read and foreign/extra output refusal. Old tool list assertion is additively updated. |

Synthetic auth/transport/store inputs establish no real owner, native capability,
store correctness, useful research, payment, installed tool or delivered result.
These files are discoverable by the existing Vitest configuration; discovery is
source inspection, not execution. No tests/compiler/app/module/build were run.

Parent next action: first run these focused client/CLI/MCP/remote cases and root,
ops and independently installed MCP types; obtain a DIFFERENT focused security
review; address any findings; then keep the coherent same-outcome focused PR and
its real required aggregate/domain/platform CI/package gates. Reuse valid
unchanged reader evidence instead of repeating old-source reviews. After the
other owner finishes, accept the relevant changed imports/inputs and combined
candidate; no whole-combined-source acceptance is made while that writer is live.

Two concrete old discovery assertions still need separately authorized parent
edits: `lib/mcp/route.test.ts:123` and
`scripts/test-monthly-mcp-package.mts:24` enumerate the old exact tool list.
They must include the new three tools before their respective HTTP/package
gates can pass. Those paths are outside this author's claim and were not edited.
Packed/private-history acceptance for the new tools must be added within the
parent's allowed package fixture scope; published0.4.20 is not that evidence.

## Exact owned source proof

Raw pins below were read from the owned source only. SHA-256 uses raw filesystem
bytes; Git blob is read-only `git --no-optional-locks hash-object` without `-w`.
Five edited pre-existing files retain CRLF, so raw `--no-filters` Git blobs are
also retained in the external `source-pins.json`. No index/ref was written.

| Owned path | Raw bytes | Raw SHA-256 | Git blob SHA-1 |
| --- | ---: | --- | --- |
| `lib/history/private-job-history-client.ts` | 14410 | `a52560c0239c516dea516fdc36b2404a9fd1ac2d1736b5c1fdd7dddd6140de84` | `4b070603679b3bc4d816947496fa8134f440b1d9` |
| `lib/history/private-job-history-client.test.ts` | 16745 | `cc68d7806a5a20589d43648c53df37b3a535cadd2ac83af565dbf99fc3621eb3` | `0ffc83e7570beb8562abe645c6004f18bca2c269` |
| `lib/history/private-job-history-cli.ts` | 4295 | `2a2b1d6328506fb3be95007b979fc9622497f9b4b830187e553e4d7f41a0064c` | `509f4bd3efe7bc021fcd4b01fd7bf41cb6009ecd` |
| `lib/history/private-job-history-cli.test.ts` | 7040 | `60683a197640d9a983c240a826788dfaeda1f4721bd808fb51b4a68197974943` | `521109e8ee00be1ec967c0ba23d102ef30032bc4` |
| `lib/history/private-job-history-mcp.ts` | 7693 | `54e5731aab8dcba40889ec1bbb6263ba6db079d8c23f6b04f248ce7dbc0aa5f9` | `eb55b7fa48b4ac45938e1d5da39278d5505c8e5e` |
| `lib/history/private-job-history-mcp.test.ts` | 16169 | `e9dc867ec64d1b67f43aebcc4c7c7cca64b06b2b5bb99fda61adc565092a06c7` | `ce261d98be8f1a0f0353d5e74c3dfd10ff4ce2dd` |
| `scripts/private-job-history.mts` | 324 | `b61154c753f49f7a52b90e999c6aba3e76ee1052e731ebd63dfbb6c22460d615` | `f974adcf2e55c4bba16cb72912ba8dbe3d46563f` |
| `lib/mcp/remote-server.ts` | 17245 | `51b2b45a380c54893c4e4c4342930a15ecee629312a263e9c921ac745a912f51` | `276659eac8ba46502ebff962070da3c6068e5cc8` |
| `lib/mcp/remote-server.test.ts` | 24404 | `0c3c01e981a01bdfd2705f1b814735fc3ee7426cc16ae131c32bc9a22322c4b3` | `b132139c9acd6777153b1ab4730b19a0600bc025` |
| `mcp/keryx-mcp-server.mts` | 10110 | `6e32f8585a4a506045fbc6f181d6e90c7d482f2207fafd20631f18b7ddd01578` | `c0caa5a04c731dc08a6e77333ef2903d48c3440d` |
| `mcp/README.md` | 34882 | `84483cb559a19d004ed5040dd7336abffa4276b3333285bc5db7ab5739fdd663` | `91990565b8b025d8e74931174080b7dc6a44f8cb` |
| `tsconfig.ops-scripts.json` | 5678 | `76dbc30282e1e99c387e4e622444f47768cbb943892c930a5c01d89950ffaa38` | `6d80eed22bd1902e4a041f815448c941e57f046c` |

Exact in-memory inverse of the five edited originals matched the entire captured
before text, including CRLF; each inverse normal Git blob independently equals
`HEAD:path`. No inverse was written over source. The raw inverse pins are:

| Edited original | Inverse raw bytes | Inverse raw SHA-256 | HEAD / inverse normal Git blob |
| --- | ---: | --- | --- |
| `lib/mcp/remote-server.ts` | 16063 | `7bed67b2698a70391aeed4a9b7d605b92330e569ea6f4923f0060b198cb808ec` | `9b66f4e586d969bead36bcd6ed2473495df0bb12` |
| `lib/mcp/remote-server.test.ts` | 15495 | `8f1832d02ede817b93f76e53423d0ace0bec6d9f533faf585ebd6728be08ce26` | `85833013346e1116c893e47b27a76880951cd718` |
| `mcp/keryx-mcp-server.mts` | 9417 | `1105e5cd3e28f132f9662f519d37adb88d68d0b213711459225915d46de40138` | `d20d0309598c75c95558f58d70466275548cec44` |
| `mcp/README.md` | 32417 | `8f1dfd506f791e709f019d365fa27c09d7c9ec5a0adff0ca62a1f180d6c8e173` | `979f21429c456971ec5416d7cc11d8fb98c06c44` |
| `tsconfig.ops-scripts.json` | 5638 | `e019401e6563fe20c65e16e8d5ca9767bc12c4082273e704637e1d139354822f` | `869b2b6cbaf6a208c6ad6f84e63abeec88165f33` |

The inverse is: remove three new remote imports and exactly the new private-tool
registration block; remove the new remote fixture imports/block and restore its
one tool-list line; remove two stdio imports and its new lazy-client/registration
block; remove the additive README introduction; remove the single ops include.
Then remove exactly the seven new client/CLI/MCP/entry source+fixture files and
this new document. It leaves every prior API, reader, contract, UI and other
owner's dirty work intact. Exact removal/replacement strings and raw/normal Git
inverse identities are retained in the assigned external output's
`source-inverse.json` and `source-pins.json`; the latter also pins this document
without a self-hash cycle.

Read-only Git diff/numstat confirms remote source +15/-0, stdio +10/-0, ops +1/-0,
remote fixture +105/-1 and README +39/-0. A Git diff whitespace check passed for
these modified tracked paths. This is source/byte evidence only. The local
PowerShell lacked the newer static HashData method, so the raw inverse hash was
computed with the compatible cryptographic ComputeHash API; this involved no
source/runtime/test execution or native-denial retry.

This author does not attest that all old imports are unchanged: the concurrently
owned pure schema extraction intentionally changes only ID/cursor imports while
preserving values. This partition did not write its hook, workspace, ID extractor,
shared contract/imports, next.config, existing reader/API or old completion/Web
documents. No whole-source/production admission is inferred from these own-path
inverse proofs.

## Original268 remains OPEN

This implements the concrete shared key-client/CLI/MCP callers for the same
completed-private-history outcome, not a replacement standalone history domain.
Original268 still requires real SQLite/Supabase paging/filter/ownership
acceptance, the combined Web correction and source graph, exact package/deployed/
installed delivery across applicable roles, several-wallet/claim/revoked-key
cases, durable #263 chat linkage, whole account/archived history, creator receipts/
ledger, own-spend classification, privacy mutations and any future broader
surface work. Unsupported capabilities remain false, rather than inferred.

The author performed only assigned source edits and routine read/hash/diff proof.
No tests, compiler, app/module/build/producer, DB/DDL/provider/target, ENV/key/auth,
model/search/payment/spend, Git writer, native-denial retry, activation, schedule,
merge, version, deploy or closure occurred. Default ChatGPT auth/model/tier/effort,
native policy, custody, limits, protected originals and private holds are unchanged.
