# Browser Gateway funding — September 9, 2026

v0.22.22 adds explicit approval and deposit controls to the browser buyer workspace.
Both steps use the connected EOA on Arc testnet. They add funds to the buyer's own
Gateway balance; they do not buy a research job or constitute Keryx revenue.

## Payment and recovery boundaries

Each plan is limited to 1 testnet USDC, with exact approval rather than unlimited
allowance. Wallet and RPC chain/account observations are checked before submission.
Unknown Circle credit stops the operation. ERC-20 funds and native gas affordability
are checked; gas and EIP-1559 fee fields are supplied to the wallet for review.

A unique active-payer index serializes plans across tabs. A transaction must commit
the claimed nonce and pre-submission block before the wallet prompt. Storage completes
at the IndexedDB transaction boundary, not an individual successful write request.
Only a wallet-reported 4001 rejection reopens a prompt. Other wallet errors, lost hashes
and persistence failures remain uncertain. The installed viem send-transaction path
uses retryCount 0 for submission. No automatic approval-to-deposit transition occurs.

Recovery uses RPC reads and proves the original sender, exact call, zero value, nonce,
matching transaction/receipt block after the saved boundary, and two confirmations.
An unrelated or older identical transaction cannot satisfy that attempt. A successful
deposit receipt does not imply immediately available Circle credit. Buyers check the
current Gateway balance before purchasing. Cancellation is local and allowed only
before an uncertain/submitted leg; a confirmed token approval remains on chain.

## Verification

- 26 focused funding tests cover amount/identity/network/gas/storage refusal, races,
  unknown wallet responses, definitive rejection and exact hash recovery.
- Actual Chromium IndexedDB tests cover concurrent plans and step claims, transaction
  commit/abort behavior, cancellation refusal and retained funding history.
- The React checkout test exercises two explicit funding prompts, a lost deposit
  response after synthetic broadcast, reload and manual hash recovery without another
  deposit. It then buys once and exercises HTTP-500 acknowledgement, private recovery,
  receipt binding and tamper refusal. All HTTP/RPC is intercepted; no real settlement.
- Public v0.22.21 recovery testing exposed React hydration error 418. Local Next dev
  reproduced the exact extra WalletConnect button from browser-only configuration.
  WalletPicker now renders a stable loading state until hydration. The same Next
  browser check then found the connector with zero page errors. Public acceptance
  must be repeated after deploying this release.

## Remaining acceptance

A fresh owner-operated testnet deposit/purchase, real wallet interruption/mobile
handoff and independent usability remain required. Local history is not authenticated
server history or permanent backup. Replaced/cancelled wallet transactions and lost
browser funding records still need a complete support/recovery flow. Current tests
do not prove mainnet readiness, external adoption or profit.

Protocol references checked September 9:
[Circle contract interfaces](https://developers.circle.com/gateway/references/contract-interfaces-and-events),
[supported blockchains](https://developers.circle.com/gateway/references/supported-blockchains),
and [EIP-1193 provider errors](https://eips.ethereum.org/EIPS/eip-1193#provider-errors).
