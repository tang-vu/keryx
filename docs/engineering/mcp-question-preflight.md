# Validate new paid MCP questions before funding

## Observed problem

The paid API uses `parseAskQuestion` with a 2000-character trimmed string limit.
The stdio buyer previously accepted up to 8192 raw characters, then loaded custody,
checked merchant/price policy and entered `ensureLocalFunding` before the server
could refuse the question. A synthetic configured-custody/merchant regression
reproduced a 2001-character question reaching the funding boundary. It did not
submit a transaction. The first isolated test timed out at its unchanged 20s
deadline; the second run reached the expected pre-fix assertion failure. Both
raw failures are retained separately from post-fix acceptance.

## Candidate behavior

Reuse the exact server parser before custody, funding or a new paid request.
Submit its trimmed canonical text. Preserve the buyer's existing three-character
minimum and 8192 raw-character transport bound; the canonical maximum is 2000 using
the server's JavaScript string-length convention, including UTF-16 surrogate pairs.
The MCP tool schema advertises 3–2000 after trimming and keeps its existing raw bound.

Within `askKeryx`, payment journals, pending funding journals and payment/funding crash locks
are checked first. A bounded pending-funding read keeps recovery guidance ahead of
new-input validation even without a crash lock; the funding helper still rechecks
the original journal before RPC and under its exclusive admission lock. MCP SDK
argument validation runs before this handler, so malformed tool arguments do not
acquire that journal-priority promise. `keryx_recover` remains unchanged, observes
the original query or transaction from its retained journal and performs no new
question validation or funding. A rejected new question creates no wallet, journal,
RPC/signing/funding action or paid call. Existing pending, failed and settled
history retains its original references and economic tuple.

## Supported surfaces

| Surface | Role |
| --- | --- |
| Caller-funded stdio MCP | New-question parser and tool schema change; MCP 0.4.9 candidate |
| Paid HTTP API, web Ask and OpenAI adapter | Already use the same 2000-character parser; backend limits unchanged |
| Buyer CLI, private preparation and Monthly | Already reuse `AskQuestionSchema`; accepted originals and closed quote schemas unchanged |
| Hosted remote MCP | Direct sponsored research with its existing 4000-character limit; no caller-wallet funding or prepaid API delegation |
| Human research CLI | Direct engine execution under existing controls; no new paid API contract |
| Desktop/native, extensions and bots | Existing reduced roles or hosted/buyer handoffs; no local-client renderer or protocol migration |

App 0.27.32 is layered after the answer-heading candidate. Hosted MCP 0.3.5 and
desktop 0.4.10 remain the parent candidate identities; no claim that they are
published or installed follows. The paid API and funding amounts, merchant/network
policy, nonce admission, retry and settlement evidence remain unchanged. This is
input validation, not current-feed qualification or a zero-charge guarantee for
other failed research.

## Acceptance and release gates

Local Node 24.21/npm 11.19 checks passed: 42 MCP regressions, 30 shared-input and
prepared-buyer tests, seven Registry checks, both TypeScript graphs, focused lint,
the isolated offline production build, package build/pack and the existing HIGH
audit (zero high/critical; low/moderate advisories remain). The canonical 0.4.9
tarball passed the unmodified clean-consumer suite on both synthetic profiles,
including the new advertised maximum/2001 rejection and valid 2000 boundary.
Financial, recovery and 30-second request assertions were retained.

The first clean-consumer attempt genuinely exceeded its initialization deadline;
its log is retained. A separate keyless loader observation and the unchanged
second consumer pass do not establish the timeout cause or cold-start reliability.
No startup runtime change or deadline waiver was made. Exact-head CI and public
delivery are separate gates.

Focused regressions must cover invalid ASCII/UTF-16 inputs before custody/effects,
configured custody/merchant before funding, valid 2000-character trimmed submission
and existing crash-lock/pending-funding priority. The actual packed 0.4.9 consumer must expose the
maximum and refuse 2001 without custody, RPC, funding or paid calls, while retaining
valid boundary research and original response-loss/no-second-debit/keyless recovery
on both supported profiles. Keep existing test deadlines and financial assertions.

Both TypeScript graphs, focused lint, package build/pack, unchanged production HIGH
audit, exact-head CI and independent payment review remain gates. Follow the
[coordinated app0.27.36 release](research-reading-release-2026-10-08.md), preserving
parent-tip inclusion and current-main operational admission. Verify production health, package publication,
distribution source metadata and applicable installer identities before claiming
coordinated delivery. Internal fixtures do not establish customer traction.
