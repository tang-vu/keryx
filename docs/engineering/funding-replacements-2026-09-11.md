# Funding replacement recovery

The research funding panel supports an explicit replacement hash from wallet activity.
It sends no wallet request and does not scan nonces or broadcast transactions. Original
transaction recovery remains available. A replacement must match the saved payer,
nonce and block boundary, have matching mined transaction/receipt/canonical block
identity, and be at or below the configured RPC's finalized block. Network identity
is checked before and after inspection. Missing evidence remains unresolved.

An exact approval/deposit call can be confirmed or reverted. A different call consumes
the original nonce but does not establish the planned deposit; the UI says it was
replaced and tells the user to check wallet activity and current Gateway credit before
preparing another deposit. It does not infer that the other call had no financial effect.
The original hash, when known, remains alongside the resolved hash. A successful
approval alone keeps the deposit plan active. Terminal deposit/replacement/revert
outcomes release the local active-plan slot, without automatically sending anything.

The IndexedDB update compares the exact inspected snapshot inside a write transaction.
Only one racing tab can resolve it. A ten-second inspection timeout and component abort
withhold mutation; a late read cannot write after timeout. Browser XSS, corrupted local
storage and a dishonest configured RPC remain trust boundaries. This does not restore
an original that was lost with all browser storage.

Validation uses deterministic RPC fixtures and real Chromium React/IndexedDB paths:
exact-call approval speedup, different-call deposit replacement, unknown hash staying
locked, retained history after reload, and cross-tab resolution races. The existing
checkout regression still covers lost original-deposit responses and no replay.
These are synthetic tests, not independently operated wallet or settled-money evidence.
The configured testnet endpoint also returned a finalized block in a read-only probe
on September 11; this proves method availability, not this recovery journey on chain.
[Arc RPC reference](https://docs.arc.io/arc/references/rpc-endpoints) remains the network
reference. No endpoint or mainnet configuration was changed.

Still required for B1: independently operated wallet speedup/cancellation acceptance,
funded current-release recovery, complete lost-storage recovery, and mobile wallet
handoff. Test completion does not mark that broader journey accepted.
