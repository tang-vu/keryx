# Exact recorded-money display

The focused implementation for [issue #274](https://github.com/tang-vu/keryx/issues/274)
keeps a positive one-micro-USDC reward visible as `0.000001`, instead of rounding it to
`0.0000`. It covers public report reward/payment summaries, archive cards, usage proof,
Telegram, Discord, Slack, human-readable OpenAI and remote/stdio MCP reward footers,
the manual research CLI, and the extension popup.

`lib/display/recorded-usdc.mjs` is the canonical browser-safe formatter. Authoritative
micro amounts must be nonnegative safe integers, BigInts within the same safe range,
or canonical integer strings. Formatting splits the integer into whole and fractional
parts without converting it to a floating-point amount. The maximum is
`9,007,199,254,740,991` micro-USDC.

Legacy recorded USDC numbers use their canonical decimal representation. The adapter
accepts only a whole number of micro-USDC within that range. It rejects missing,
nonfinite, negative, unsafe and fractional-micro values and displays `Amount unavailable`.
It does not repair a floating-point sum by rounding. When payment legs are available,
the citation dialog sums their exact integer micro amounts; one invalid leg makes the
total unavailable. This does not change which legs count as settled.

Existing four-place or two-place display padding remains where used, but it never drops
known micro digits. Ordinary legacy `0.012` still displays as `$0.0120` in bot footers;
`0.000001` displays as `$0.000001`. Pending, failed, simulated, planned and settled labels
retain their existing meanings and evidence requirements.

The extension contains a byte-identical distribution copy, `extension/recorded-usdc.mjs`.
It works when loaded unpacked. Vitest and the ZIP pack preflight verify equality. After
editing the canonical module, synchronize and check it with:

```text
node --import tsx scripts/sync-extension-usdc.mts
node --import tsx scripts/sync-extension-usdc.mts --check
```

The human-readable OpenAI/MCP footer strings may change. Structured monetary numbers,
machine-readable schemas, stored answers, private originals, portable receipts/digests,
CSV/BibTeX/RIS and authorization/signing data remain unchanged. This is not a claim that
an entire HTTP response remains byte-identical. Desktop's existing monetary helper also
feeds its generated buyer command and remains unchanged in this display-only phase.

Acceptance uses integer/legacy rejection cases, rendering and adapter tests, an in-memory
MCP client, exact distribution-copy checks and local Chromium popup import/rendering
fixtures. These are zero-provider fixtures, not new settlement or outside-user evidence.
The popup fixture records its test-only renderer export seam separately from the exact
uninstrumented module import. A separate fresh local unpacked MV3 profile verifies the
actual extension worker, Chrome APIs and uninstrumented popup/module import. No Ask
button, provider request or payment is invoked. This does not establish store installation.

Issue #274 remains open for locale preference integration, dates/time zones, plural rules,
broader display migration and review of signing/confirmation wording for every shipped
locale. This source change does not claim deployment, a newly installed extension or
desktop synchronization; those require the coordinated release's actual readbacks.
The required CI production build gates the new client import boundary; a coordinated
release still needs its own deployed source and distribution verification.
