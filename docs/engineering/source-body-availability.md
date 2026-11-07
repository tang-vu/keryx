# Readable exact article bodies

An exact article body must contain non-whitespace text after plaintext retrieval
or DB/IPFS decryption. Matching hashes, byte commitments and valid encryption do
not establish usable text. Valid content is returned unchanged, retaining Unicode,
whitespace, hashes and quote offsets. The shared resolver applies this check before
returning the body; existing manifest, version and authority checks remain intact.

Creator-free article reads still refresh the current source price/claim and exact
version before delivery. An unavailable exact body returns the existing API 503
refusal and creates no access payment or paid cache entry. Exact reads never
substitute a preview. Legacy bundle callers may retain their existing explicit
preview fallback only when that preview itself has non-whitespace text.

Paid browser/server consumers already reject blank bodies. A producer refusal
after settlement still follows the existing 500 response with PAYMENT-RESPONSE;
the original debit/nonce/amount remains recorded. This change adds no refund,
reservation release, signature, funding, paid retry or new settlement authority.
Encryption format, master-key custody and policy admission are unchanged.

The regressions exercise real AES-GCM decryption, mocked ciphertext transport and
version-bound free/paid producer APIs. They retain valid padded Unicode text and
prove no fabricated payment for free refusal. These controlled fixtures establish
behavior, not real settlement or independent answer quality. The existing 48-trial
offline study is reproduced with identical outputs and no outbound attempts; only
the current resolver input fingerprint changes.
