# Browser buyer engine checks — September 9, 2026

Scope: v0.22.19 internal purchase/recovery engine. No checkout UI is enabled and no
new payment was made. This advances B1; it does not complete wallet funding, browser
UX, private server history, mainnet readiness or independent buyer adoption.

## Authority and implementation

`lib/buyer/browser-journal.ts` stores a versioned intent in IndexedDB with an exclusive
insert, strict transaction durability and validated read-back. Successful write requests
are not treated as committed transactions. The submission transition is atomic across
tabs; imported journals cannot acquire it. Private recovery exports use the existing
CLI intent format. Deletion removes local data only. Storage eviction/device loss still
requires an exported recovery file; browser storage is not a permanent archive.

`lib/buyer/browser-client.ts` quotes without a signer, compares the fresh amount to the
exact accepted total, checks account/chain/Gateway funds, saves the journal, exposes it
for recovery export, and requests an EOA signature. It checks the recovered EIP-712
address and repeats the wallet check before committing the one-shot submission gate.
The caller supplies the connected-wallet and Gateway-balance adapter; that adapter and
the actual wallet/deposit UI still need implementation and runtime acceptance.

Only allowlisted seller-relayed payment evidence is persisted, before checking HTTP
success. An HTTP 500 can therefore retain an acknowledgement without claiming delivered
research. A storage failure retains evidence in the immediate return value but reports
that it was not persisted. Response loss, missing acknowledgement and a missing job
remain uncertain. There is no automatic signed retry. Recovery has no signer or POST
path and verifies package, economics, original request and receipt digest.

The shared transport has a 30-second deadline, caller cancellation, no credentials,
no redirects and a pinned HTTPS origin. The Node CLI keeps its existing quote API.
Browser bundles must not import server configuration, Node journals or database code.

## Verification

- 100 focused Vitest tests passed across buyer, package, order and receipt suites.
  New cases cover changed totals, wallet/chain changes, insufficient Gateway funds,
  storage/export failure, wrong signer, rejected prompt, cancellation, failed claim,
  lost responses, acknowledgement-storage errors and HTTP 500. Completed recovery
  rejects a rehashed receipt that substitutes another research question.
- TypeScript and focused ESLint passed.
- `npm run test:browser-buyer` builds the actual modules for Chromium and checks
  exclusive creation, cross-tab claims, reload refusal, import/export/deletion,
  transaction aborts after successful add/put requests, a real synthetic EIP-712
  signature, acknowledgement retention on HTTP 500, extra-field stripping and
  GET-only recovery in another reloaded tab. All HTTP requests are intercepted;
  the deterministic test signer is never funded or used against a network.
- The browser test is a required CI step. On a new development machine run
  `npx playwright install chromium` first; CI installs Chromium's Linux dependencies.

This is Chromium evidence; Safari/Firefox, actual connected-wallet prompts, deposit
finality, UI interruption and an owner-operated testnet purchase are not yet proved.
The signature helper is checked against installed `viem` source and Circle batching
SDK 2.1.0's `TransferWithAuthorization` domain/fields. Circle's
[supported-blockchains table](https://developers.circle.com/gateway/references/supported-blockchains)
still lists Arc as testnet-only when checked on September 9. No mainnet permission
or availability is inferred.
