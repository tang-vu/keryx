# Portable Research Receipts

Every completed Keryx dispatch has a public, deterministic receipt:

```text
GET https://keryx.cc/api/dispatch/{queryId}/receipt
GET https://keryx.cc/api/dispatch/{queryId}/receipt?download=1
```

The first form returns JSON inline. `download=1` adds an attachment filename. Both responses carry
the same digest in `X-Keryx-Receipt-Digest` and `integrity.digest`.

## What the receipt binds

The SHA-256 covers the full `payload`, canonicalized with recursively sorted object keys:

- exact public question and answer, plus a separate stable hash of the answer text;
- the agent's visible BUY/SKIP/CACHE decisions and their claim targets;
- decomposed claims, evidence-bounded coverage and public evidence excerpts;
- cited source/article identity, SHA-256 or IPFS content version, and public publisher manifest;
- a sanitized snapshot of every creator access/citation payment state.

Evidence excerpts remain capped by the existing evidence ledger. Paid article plaintext, cache
contents, encryption material, session/payer addresses, authorization nonces and internal database
ids are not exported.

## Verify a file or URL

From this repository:

```bash
npm run verify:receipt -- ./keryx-receipt-QUERY_ID.json
npm run verify:receipt -- https://keryx.cc/api/dispatch/QUERY_ID/receipt
npm run verify:receipt -- ./keryx-receipt-QUERY_ID.json --expect sha256:RETAINED_DIGEST
```

Exit code `0` means the recomputed payload digest matches its integrity block. For an HTTPS URL the
tool also requires a supplied `X-Keryx-Receipt-Digest` header to match. For an archived file,
`--expect` compares a digest you retained separately; without that separate value, a party that
changes both payload and embedded digest can still create an internally consistent self-check.
Exit code `1` means a comparison failed or the receipt uses an unsupported schema/integrity block.

The verifier performs no wallet operation and sends no transaction. When passed a URL it makes one
read-only HTTP request; when passed a file it reads only that file.

## Settlement semantics

`citations[].rewardPlannedUsdc` records the agent's allocation, not proof that money moved. Actual
money is reported only under `settlement`:

- `settled*` totals include only durable rows carrying Circle settlement evidence;
- `pending*`, `failed*`, and `simulated*` totals never enter settled creator money;
- `ledgerCompleteness: incomplete` means the durable rows do not match a new run's recorded
  finish-time settled-plus-pending count;
- `circleTransferId` is a Circle Gateway reference, not a per-payment Arc transaction hash.

Exact Circle reconciliation may later resolve a pending row to `settled` or `failed`. A fresh export
then has a new payload digest, while `dispatch.answerSha256` remains unchanged.

## Trust boundary

This is an integrity checksum, not an authenticity signature. It detects unrecomputed edits and,
when a digest is retained separately, later payload changes. The embedded hash alone cannot
independently prove that Keryx originally served those bytes. Publisher
EIP-712 content manifests authenticate opted-in full text; SourceRegistry remains creator/payee/price
authority; Circle remains settlement evidence; ArcScan transaction hashes remain on-chain cash-out
proof. The portable receipt composes those public references without replacing any of them.
