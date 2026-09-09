# Portable buyer recovery — September 9, 2026

v0.22.26 addresses the browser pilot's missing portable payment acknowledgement.
Saved-job exports now contain `keryx-buyer-recovery-v1`, the original intent and any
saved HTTP status/allowlisted seller evidence. CLI `import` and `export` share the
format with the browser. Legacy intent-only files remain valid.

## Authority and failure behavior

- All inputs are bounded to 64 KB, with strict field validation and runtime job-ID
  recomputation. No signatures, keys, submission permission or endpoint override is
  accepted. Unknown evidence remains unknown; copied evidence is never independent
  settlement proof. Payer/network checks do not cryptographically bind a seller
  acknowledgement to an individual job.
- Browser import writes the intent and acknowledgement in one exclusive IndexedDB
  transaction and always sets recovery-only state. Duplicate import cannot replace
  an existing journal or reopen its signing gate.
- Node import uses a fresh single-use private directory; files are exclusively
  created and fsynced. It does not remove a partial directory after a write failure.
  Such a directory is recoverable if its intent survived, and never reusable by `buy`.
  Export refuses an existing destination and malformed stored acknowledgements.
- Import/export have no signer or HTTP path. `resume` still fetches only the original
  job and receipt, with separate integrity and original-request binding checks.

## Verification

The buyer suite passed 116 tests including native CLI import/export with no wallet
and a network-refusing harness. Chromium exercised browser-to-Node-to-browser
round trips with the acknowledgement retained and submission still locked. The
React UI exercised an uncertain HTTP response, export, local removal and reimport,
followed by receipt verification with no extra signature or payment POST.

The existing owner-operated pilot was also recovered using the new local code:
its browser profile was opened with every HTTP request intercepted, the actual
saved journal was exported, and the native CLI imported it into a fresh private
directory. CLI `resume` then performed live GET recovery and returned completed,
seller-reported acknowledgement retained, receipt integrity verified and original
request binding verified. This recovery created zero signatures and zero payments.
Private questions, identifiers, profiles and receipts remain in ignored artifacts.

This is recovery of the same owner-operated Arc-testnet job, not another purchase,
independent customer, new settlement or mainnet revenue. Wallet/funding backups,
lost IndexedDB recovery, authenticated server history, external usage and full
mainnet readiness remain open.
