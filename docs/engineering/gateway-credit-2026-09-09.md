# Gateway credit uncertainty — September 9, 2026

The browser buyer funding integration depends on a trustworthy distinction between
known zero funds and an unavailable lookup. The former single-address reader defaulted
a missing balance row to zero; `/api/session/credit` and the creator panel also converted
upstream failure into zero. Signature-based session recovery could consequently treat
an outage as no recoverable session and clear its in-memory signer.

The v0.22.20 reader validates the response token, exactly one requested domain/depositor
row and a nonnegative decimal with no more than six fractional digits. Conversion uses
integer micro-USDC, without rounding; malformed, missing, duplicate or mismatched rows
stay unknown. It imposes a 15-second upstream timeout, redirect refusal and bounded JSON.
`pendingBatch` is not added to available funds. The multi-creator held-balance observer
remains separate and unchanged.

The credit API returns `{ status: "known", address, network, available }` for a known
balance, including explicit zero. Invalid addresses get HTTP 400; unknown funds get
HTTP 503 and `available: null`. All responses are non-cacheable. It remains a public
balance lookup, not wallet ownership authentication. Existing callers now use a shared
identity-checked browser decoder; session recovery throws a retryable error on unknown
funds, and the creator panel shows unavailable/retry instead of zero. An old response
for another address cannot populate the current creator's displayed balance.

Focused decoder/API/grant regression tests, TypeScript and ESLint pass. The decoder
was also checked read-only against Circle's live testnet balance endpoint: HTTP 200,
USDC token, one row with domain/depositor/balance/pendingBatch and a known decoded
balance. No signature, deposit, withdrawal or other on-chain write was made.
Production UI and endpoint verification must follow the deployment; unit tests alone
do not prove the live behavior.

Protocol reference checked September 9:
[Circle: token balances](https://developers.circle.com/api-reference/gateway/all/get-token-balances).
The installed batching SDK 2.1.0 also throws for an absent balance row instead of
assuming zero. This correction does not complete the buyer's wallet/deposit UI.
