# Ledger presentation English catalogue — 2026-10-11

This issue272 area adds 93 meaning keys for the dashboard, its two Suspense
fallbacks and compact/full payment records. It retires exactly 83 allowances
from those three files; no scoped allowance remains. Other areas' allowances
and baseline provenance remain intact. An existing parser regression test now
requires these files to contain no detected literal copy.

Complete resource notices use named label, UTC observation and retry-control
placeholders. Count and stale-count variants retain the styled count span and
explicit one/other arms. Original wording, including `1 recorded questions`,
`authorization(s)` and `attempt(s)`, stays exact. Abbreviated ages retain the
same rounding, boundaries and units. Payment tooltips and reference lines use
complete named messages. The empty transaction-reference edge still renders
the original blank reference when an authorization ID is also present.

Settlement classification, amount formatting, network provenance, polling,
validation, retry callbacks, record filtering, cash-out authority, routes and
component markup remain unchanged. Payment kinds other than the human
operating-fee label remain recorded data. Imported authorization-phase prose
in `lib/payments/payment-state.ts` is a root-owned helper qualification; this
area preserves that import and its exact output.

## Retained verification

Worker receipts live under
`output/codex-cli-workers-20261011-01/issue272/ledger/` outside tracked source.

- 424 exact before/after HTML comparisons cover both Arc profiles, all resource
  states, zero/one/many and unavailable counts, stale observations, pending and
  failed notices, payment kinds/statuses, all authorization phases, original
  networks, timestamp boundaries, tooltips/references and actual fallback nodes.
- TypeScript, scoped ESLint, all 24 copy-guard tests and the 12 existing
  catalogue/rich-message tests pass on the candidate source.
- The existing dashboard browser assertions pass at 320, 768 and 1440 pixels
  on both profiles. Only changed dashboard assertions were rerun; unchanged
  archive/source-directory assertions reuse their existing evidence. The fixture
  intercepts GET reads and exercises unavailable/retry/stale/malformed totals,
  pending/failed proof notices and retained networks. No real payment, provider
  request or data write occurs.
- Retained-CSS before/after renders have equal dimensions: 320/320 scroll width,
  height3471; 1366/1366 scroll width, height2425. Both were visually inspected,
  together with actual fixture dashboard screenshots at 320 and 1440 pixels.
  The original full payment table scrolls inside its container at narrow width.

These fixtures isolate existing header/footer and server data dependencies.
They establish scoped English/render/action parity, not a fresh production
Next.js build or full-site accessibility certification. Root owns the final
combined source review, actual aggregate/domain/platform CI, distribution,
merge and one production delivery. Human financial/glossary approval and locale
activation remain held. This area alone does not close original issue272.
