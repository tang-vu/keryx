# Inspectable agent decisions: Vestiarion adoption

The owner requested implementing the useful Vestiarion patterns for Keryx's
hackathon entry on October 12, with first place as the objective. That objective
does not establish a judging result or relax Keryx's quality, money, privacy,
release or independent usefulness gates.

## Source and baseline

Checked [Vestiarion](https://github.com/duongnq2798/vestiarion/tree/cd2eb768b6b1d5764c8519665a4abb0f4afb25e9)
on October 12, 2026 at `cd2eb768b6b1d5764c8519665a4abb0f4afb25e9`.
Its [MIT license](https://github.com/duongnq2798/vestiarion/blob/cd2eb768b6b1d5764c8519665a4abb0f4afb25e9/LICENSE)
was inspected. This is a native adaptation of patterns, not copied upstream code,
an added SDK or evidence that upstream tests passed locally.

Relevant upstream files:

- `src/lib/research/model-vs-policy.ts`: distinguish model proposals, written policy
  and guardrail refusals. Agreement with policy is not answer-quality acceptance.
- `src/lib/policy-replay.ts`: bounded comparisons and an explicit cannot-tell
  result when historical facts are missing.
- `src/lib/shadow-mode.ts`: an inspectable trial before financial execution.
  Upstream's switch is testnet-only; Keryx does not copy it into a mainnet worker.
- `src/lib/ledger.ts` and `src/lib/ledger-export.ts`: signed records and standalone
  verification. A Keryx signed export snapshot is not their continuous ledger.

The initial survey used the older detached checkout `b67b0653`. Development first
refreshed main to `b6009528`: supported ordinary READ capture already had versioned
mapping, normalization, optimizer and admission replay. Existing decision reviews
also retain human feedback. Those implementations remain the authority. The
gap was making checkpoints inspectable and comparable without another policy,
and providing a separately anchored signature on an exported snapshot.

## Delivered source behavior

`/operator/decisions` starts with a labelled synthetic example of BUY, budget SKIP,
CACHE, human-review ESCALATE and STOP. It calls only the existing deterministic
checkpoint evaluator. It makes no original-content reads, model/search calls,
signatures or payments. This is a no-spend decision demonstration, not a completed
research task, production shadow worker or new scheduler.

Supported reports display the same inspection beneath their existing checkpoint
verification. Candidate, round, recorded model proposal, selected plan, checkpoint
result and rule remain separate. Run-context default BUY markers never become
model proposals. Totals count each candidate's latest terminal checkpoint once,
exclude CONTINUE/global STOP and preserve UNKNOWN. Recorded final actions and
checkpoints are distinct observations; source facts are not independently proven.

The preview changes only reader-supplied remaining budget and attention limits at
recorded checkpoints, calling `actualReadCheckpoint` unchanged. USDC entry converts
to canonical micro-USDC without rounding; unsupported values are refused. It
preserves the original Number predicate and tolerance. It does not rerun the model,
optimizer, later reads, allocation, reservations, signatures or settlement. The
alternative research trajectory and answer quality remain unknown.

Users may inspect a bounded local checkpoint file after separately supplying the
digest retained by a report. Local file processing uses browser JSON/Web Crypto;
files are not uploaded or persisted. A new file/key/digest, reset or unmount
invalidates earlier asynchronous success. Existing v1/v2/v3 replay and privacy
projections are unchanged; missing/private/native capture remains unavailable.

## Signed export, key authority and limits

`npm run audit:decisions -- --help` documents the offline sign/anchor/verify CLI.
Signing requires a separately provisioned Ed25519 PKCS8 audit PEM in
`KERYX_AUDIT_SIGNING_KEY_PEM`. Keep it in a private environment file; load that
file explicitly only for signing. The tool generates and persists no key and
never reuses a payment key. No key was provisioned or activated by this release.

The closed, bounded envelope signs the purpose, format, public-key fingerprint,
exact canonical packet digest/schema, optional report digest and export timestamp.
Public key IDs are SHA-256 of Ed25519 SPKI bytes. Verification requires a public
key obtained separately: an embedded key cannot authorize its own export. Key
rotation uses a separately selected original/retired public anchor; old snapshots
are not rewritten. Changed fields, packet, signature, algorithm, purpose, key,
unknown/private data, malformed encodings and asynchronous mutation are refused.

For a separately provisioned audit key, a local example is:

```powershell
node --env-file=.env.audit.local --import tsx scripts/decision-bundle.mts sign read-checkpoints.json > signed-decisions.json
npm run audit:decisions -- anchor trusted-audit-public.pem
npm run audit:decisions -- verify signed-decisions.json trusted-audit-public.pem <retained-packet-sha256>
```

Use the anchor's public `publicKeySpki` field in Decision Lab. Retain/share the
public anchor through an independently trusted channel. CLI output may be a
private recording; keep it out of Git. Verification without a separately retained
packet/report digest proves only that the trusted audit key signed that snapshot.
The timestamp, facts, completeness and payment state remain signer assertions.
No continuous append-only ledger, external timestamp, on-chain anchor, source truth,
semantic quality or confirmed settlement is certified.

## Surface and release boundaries

| Surface | Result |
| --- | --- |
| Web/report | New local lab and supported report inspection; app identity changes. |
| API/OpenAI-compatible/remote MCP/A2A | Existing ordinary v1/v2/v3 packet projections and authority unchanged. Their exported packet can be inspected locally. No new public audit signer or private API. |
| Repository CLI | New bounded offline signed-export tool and public-anchor verification; no environment/application configuration loader or HTTP/DB client. |
| Published stdio MCP/Windows desktop | Existing hosted/report/export handoff; no installed local verifier or audit signing capability added. Their package/installer bytes and identities are unchanged. |
| Extension/Telegram/Discord/Slack | Existing report handoff reaches the web inspector. No new local signer, capture enrollment, background execution or adapter protocol. |
| Shared Rust engine | No cutover or competing runtime rule engine. Existing TypeScript authority and staged migration gates remain. |

Tests cover strict canonical input, unknown/missing facts, exact previews and
original tolerance, candidate/STOP counting, tampered bytes/metadata, separate key
anchors, synthetic key rotation and stale asynchronous verification. Browser
acceptance mounts the real React components in Chromium with `connect-src 'none'`,
proves no privileged client imports/external requests, and exercises local imports,
preview and signature refusal. Local TypeScript/lint/build, compiled route/layout
acceptance, required CI, independent review and deployed commit are distinct gates.
Record their actual results at release, never infer them from these test descriptions.

### Local candidate acceptance

On October 12, the focused eight-file suite passed 122 tests, including the new
inspection, signer/browser contract and CLI plus adjacent v1/v2/v3 replay tests.
App and operations-script TypeScript passed. ESLint passed with zero errors and
ten existing warnings in unrelated files. The UI-copy guard passed. The pinned
Next 16.3.8 Turbopack production build passed after installing physical worktree
dependencies; the initial shared dependency junction was refused by Turbopack.

Real Chromium mounted-source checks passed: local import, separate digest and
public-key anchors, tampered input, invalidated asynchronous imports, and the
later-round run-context BUY display regression. The existing ordinary report's
offline prop/digest verification checks also passed. Compiled Next acceptance
passed on 1280px and 390px viewports with no page-level horizontal overflow,
browser writes, page errors or external requests. Desktop/mobile screenshots
were visually inspected. Independent source review found the run-context display
and preview-reset issues; both were corrected before the candidate was pushed.
Hosted CI, merge and production delivery are not implied by these local results.

## Demo and remaining work

In a short reviewer journey: open Decision Lab, show model BUY blocked by the
recorded budget, change the hypothetical budget, explain why only that predicate
changed, then verify an exported recording and refuse changed bytes or a wrong
audit key. Keep the synthetic label visible. Follow with a separately evidenced
real report/payment if available; this release performs no funded canary.

A continuously signed operational ledger needs its own durable ordering/key
lifecycle and retained-head design. An externally trusted audit key must be
provisioned before claiming production-authored signed snapshots. Contract-enforced
treasury limits need an independent x402/Gateway architecture and audit; upstream's
`transferFrom` contract is not directly applicable. Independent buyer usefulness,
real creator rights/settlement and hackathon traction remain separate evidence.

Rollback removes the added lab/inspection and offline export entrypoints. Existing
recording formats, payment state, custody, database and recovery remain readable;
there is no DDL, storage migration or production key change.
