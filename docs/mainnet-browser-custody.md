# Normal browser mainnet custody and payment admission

This prepares the full public Keryx mainnet cutover on `keryx.cc`, not an invited-wallet pilot. It does not authorize deployment or real funding. Both unset network labels retain Arc testnet. Mainnet requires matching server/public labels and independently compiled registry authority. Requests cannot choose a network or RPC.

## Retained original custody

Mainnet custody binds canonical network pins, exact HTTPS origin and connected owner, independently of mutable grant epochs/caps. Its secret wallet derivation signature stays local and never reaches the server. Existing funded testnet identities retain their exact historical message and worker policy. Keys, grants and journals are not relabelled between networks.

Before funding, the worker commits the original AES-256-GCM ciphertext and namespaced nonexportable wrapping key in native IndexedDB. Encryption authenticates the custody identity and signer address. Concurrent enrollment retains the first original; even another valid wallet signature cannot silently rotate it. Logout locks heap custody and invalidates unfinished publication. It does not destroy original recovery, refund funds or claw back exposed authorizations. Payment expiry also retains custody.

This is a **same-browser storage dependency**. Reload/logout can restore the original without another derivation signature. Wiping browser data, losing the device or losing its wrapping key can lose access to the funded signer. Repeating `personal_sign` elsewhere is not a guaranteed backup across wallet implementations. Funding UI states this limitation before requesting funds. This implementation claims no portable encrypted recovery export.

This is **not an XSS-proof vault or on-chain spend cap**. Same-origin script can obtain the IndexedDB wrapping CryptoKey and ciphertext and invoke decryption despite nonexportability. It also observes the initial wallet derivation signature on the page. Worker message isolation restricts ordinary/raw signing paths and independently rejects untrusted challenges, but a compromised origin/browser/signer can put deposited funds at risk. The release assumes a trusted application origin and browser; nonexportability only prevents raw AES key export.

## Owner funding and dual consent proofs

The connected owner reviews exact ERC-20 USDC approval and `GatewayWallet.depositFor(USDC, sessionSigner, amount)`. Token amounts use six decimals; native gas uses eighteen and is separate. The mainnet worker has no funding transaction API. Session funding reuses the normal buyer transaction journal with an explicit depositor. Sender, nonce, exact calldata, hash, confirmation and replacement evidence remain bound to the original operation across reloads/tabs. Unknown submission/storage outcomes retain the attempt and never trigger another deposit. On-chain confirmation alone does not claim Circle credit. The unique funding lock remains held until known Circle availability plus strictly confirmed original debits admitted after the saved balance observation includes the original pre-deposit balance plus amount. The authenticated accounting projection binds the same network, signer and observation. Older pending authorizations that confirm later, raw lifetime debit increases, unknown holds and receipts alone cannot supply that offset. Credit lag cannot create another automatic deposit prompt.

Authenticated `POST /api/session/grant/challenge` receives `{sessAddr, budgetMicros, recover?}` and issues `{consent, funding}`. `budgetMicros` means desired **current** capacity. Consent signs an absolute cumulative signer cap: confirmed lifetime debit plus the lesser of that desired capacity and freshly known Gateway availability. Funding metadata exposes confirmed debit, retained spend/holds, available funds and proposed remaining capacity. The browser checks the arithmetic and shows it before requesting owner consent. Pending/unknown signed liabilities remain held.

The owner signs the readable exact consent. The worker verifies that signature and captured custody, then produces a separate narrow session-possession proof. `POST /api/session/grant` sends `{consent, signature, sessionSignature}`; the secret derivation signature is absent. Both public proofs bind the server-issued single-use epoch, owner, signer, network, origin, cap and expiry. The server verifies both before atomic challenge consumption/grant admission. A public funded address alone must not let a foreign owner reserve its global capacity before a payment signature exists.

Renewal requires new explicit owner consent and freshly known funds. Neither renewal nor top-up resets retained lifetime spending. Adding funds preserves the exact previous cumulative cap plus the chosen deposit as an immutable ceiling. If confirmed spend changes before the next proposal, the browser refreshes the requested current capacity at most three times and refuses an excessive proposal before owner signing. The acknowledged deposit is retained rather than repeated. Mainnet UI reports owner consent capacity and retained spend/holds; receipts separately report actual settled, pending and uncertain payments. Public owner/network/origin-scoped selectors retain every historical grant epoch for original-proof recovery; these selectors confer no authority.

## Payment admission

Ordinary research SSE supplies a request-ID notification. The dedicated worker fetches the authenticated original from `/api/ask/challenge` and verifies the current dual-proof grant. Before an article payment it fetches the exact ordinary version-bound item preview and compares the complete receipt/identity against the admitted journal item, then independently checks payout and list price. It reads fresh source payout/author/price authority from the compiled registry read pin over the static mainnet RPC, attesting chain before/after reads and checking the pinned block hash. There is no DB payout fallback or stale result. Wrong payee/price/network/nonce/grant, an unverified discount, inactive source or unavailable authority refuses that leg; another source can still contribute to the answer.

One atomic IndexedDB reservation records cumulative lifetime signer exposure, the immutable local question budget and its running sum, and the unique nonce before cryptography. The user interface creates the question UUID and integer budget before the request; each SSE handler retains that originating scope. The amount comes from the authenticated journal challenge, never the SSE notification. Epochs, logout, reload, failure and timeout never reset retained exposure. A newly owner-signed absolute cap permits only additional capacity above retained exposure. The worker reauthenticates the unchanged grant before and after cryptography, suppressing publication after another tab's revocation. It exposes no arbitrary mainnet `signTypedData`, `signMessage` or `signTransaction` operation.

An unavailable session-status lookup or expiry immediately invalidates payment registration and locks heap custody while retaining local recovery. Cached question callbacks require the exact published registration, current clock, owner and signer before dispatch and again after worker awaits. They cannot spend while paused or become active again merely because the same owner/epoch was restored. Explicit recovery publishes a fresh local registration. Native-handler/React/production-worker acceptance verifies zero paused dispatch and no header/settlement when a lookup failure occurs during an original challenge await.

## Lifecycle recovery UI — October 4

Automatic restoration shows a working state and holds one lifecycle operation
before its first await. Activation, top-up and renewal do not queue behind it.
If an owner change or React effect replay invalidates an operation, automatic
recovery waits for it to finish and only reads the current owner's retained
custody. Disconnect pauses with reconnect guidance. No old wallet action replays.

A worker response distinguishes a successful empty original-custody read from
storage/decryption/operation failure. Only the empty read permits first derivation.
Corrupt or inaccessible saved custody stays an explicit recovery error. Inactive
server consent keeps the saved address and prompts renewal rather than displaying
raw schema failures. Custody bytes, namespaces, wrapping keys and the grant/payment
protocol remain unchanged; the private worker response adds one optional error code.

## Owner-only session cashout

The ordinary session panel reviews an exact amount and maximum USDC fee before preparing an authenticated original withdrawal. Expired or revoked payment consent remains usable only as retained owner/session custody proof; it does not reopen payments. The worker accepts only an original request ID and the locally reviewed amount/fee ceiling. It verifies both original public signatures, its own owner/signer/origin, static mainnet contracts, a finite compiled block window and fresh selected-chain RPC observations.

Outstanding exposure is distinct from lifetime spending. The browser matches its retained nonce and complete requirements digest against owner-scoped original journal rows. Only exact real-settled originals distinguish historical debit; missing, mismatched and unknown authorizations remain held. One strict-durability IndexedDB transaction compares the payment-admission version and reserves a withdrawal barrier before signing. Another tab cannot admit a payment in that gap. New payments remain closed while the withdrawal is unresolved.

Before burn cryptography the browser durably records possible exposure and requests the server's atomic authorization marker. A lost acknowledgment retains both local recovery and the barrier. Cancellation succeeds only for an original never exposed on either side. Cancelled IDs remain retained and cannot be reused. Neither timeout nor an empty lookup releases uncertainty. Fresh balance and Circle processing metadata use a fixed same-origin server relay and therefore trust that server and Circle's JSON authority; the browser does not claim independent vendor cryptographic proof. Selected RPC chain, contracts, block identity and finite bounds are checked independently.

The browser retains the original burn signature and one transfer-delivery slot before HTTP submission. It never repeats an uncertain transfer automatically. The connected original owner separately reviews mint calldata and native gas through their wallet; the session worker has no transaction-signing or gas authority. Exact owner nonce, calldata, gas and fee terms are retained before the wallet prompt. A rejected or lost response leaves an original recovery attempt, not permission to mint again. Historical IDs and known owner transaction hashes remain available after reload.

The server reconstructs the original owner mint transaction and observes its exact event/finality. Before releasing its local barrier the worker verifies the original completion packet and independently reads the selected RPC transaction, receipt and finalized block. Only that completed withdrawal barrier is removed. Old burn salts, authorizations, question budgets and lifetime signed consumption remain retained, allowing explicit new funding/consent and research with the same stable signer afterward.

## Validation and remaining release work

### Ordinary creator owner-wallet withdrawals

The normal creator earnings panel and `/me/withdrawals` select the configured network. Mainnet creators review an exact USDC amount and maximum Circle fee before preparation and again before their owner wallet signs the finite original BurnIntent. The browser independently checks its compiled profile, contracts and maximum-ahead block pin against fresh RPC height. A different amount, fee, owner or network cannot reach the wallet signing prompt.

Mainnet creator journals use a fresh `keryx-creator-withdrawals-v2-arc` IndexedDB namespace. Legacy testnet records remain in their original namespace and retain their original network; they are never relabelled or imported as mainnet authority. A valid returned burn signature is retained before delivery. One atomic local claim precedes transfer submission. Lost responses, imported originals and reloads permit recovery reads, never another transfer.

Creator and session cashout share the narrow owner mint helper. It independently verifies the original signed burn, matching Circle attestation, static mainnet minter authority, owner account/network, exact calldata and known native gas. The owner wallet submits that reviewed transaction. Original nonce, calldata, gas and fee terms are durably claimed before the prompt, and any returned hash is retained even if the connected owner changes during the prompt. Reload restores that original hash without granting another mint. Server completion is checked against the original raw owner transaction and independently against the selected RPC receipt, exact event and finalized block before the UI reports verified finality. No treasury gas relay or session transaction authority is introduced.

Actual Chromium/React acceptance runs the ordinary creator component through normal authenticated prepare/submit/status/complete handlers and fresh native SQLite, with synthetic external Circle/RPC transport. It refuses a changed amount or fee before signing, retains one lost transfer, reloads the original owner mint hash, verifies finality and preserves independent testnet/mainnet journals. This is source acceptance; it is not live funding or withdrawal evidence.

Real EOA tests cover identity/address AAD, different valid derivation signatures retaining one original, logout/reload restore, delayed commit cancellation, owner/session proofs, exact journal payment signatures, post-crypto revocation and retained exposure. Chromium runs the production worker with native IndexedDB and synthetic cookie/registry transport. Packaging acceptance additionally loads the actual Next/Turbopack bootstrap and emitted dependency chunks under the generated Next CSP using synthetic matching build pins. No live funds or production synthetic activation flag is used.

Actual normal-handler composition acceptance now uses a fresh sealed native SQLite deployment and actual JWT-backed web-session authentication. Chromium worker authorization runs through normal grant/challenge/sign handlers, streamed research, encrypted content seller and citation settlement with synthetic external RPC/Circle transport. A citation failure retains its uncertain liability while the completed cited answer persists. Next emits and runs the actual worker/bootstrap/dependency chunks under its generated mainnet CSP. These are synthetic transport checks, not live payment evidence.

The actual React lifecycle additionally exercises canonical cumulative POST metadata, retained spent, and worker-bound proof publication. Captured generation and exact current consent fence delayed logout or replacement responses. A delayed original revoke arriving after renewal cannot delete the replacement server epoch, and mainnet custody remains locally retained. Synthetic Chromium checks cover an over-budget .011 payment against a .01 question despite a .5 grant, the honest .006 + .004 sum across tabs, and refusal to enlarge that question's original cap.

Actual React funding acceptance submits only exact owner approval and depositFor transactions to synthetic chain transport. It settles research during approval and again after credit reconciliation but before the grant proposal, proves original credit acknowledgement despite the concurrent debit, and signs only the original cumulative target after a bounded refresh. Exactly one deposit remains recorded; unknown/older debit projections fail closed in focused checks.

The actual React cashout journey now exercises normal prepare/authorize/submit/status/complete handlers with a fresh sealed SQLite deployment, Chromium worker/IndexedDB and synthetic external Circle/RPC transport. It cancels a never-exposed original, retains a lost transfer response without another transfer, submits an actual owner-signed serialized mint transaction through the ordinary component, verifies original mint finality and resumes cited research with the same signer. Focused checks cover expired custody, wrong origin/recipient, cross-tab admission races, retained uncertain liabilities and lifetime-cap preservation. The actual Next-emitted worker and generated CSP also exercise the narrow expired-custody cashout path with matching synthetic build pins.

The full release still needs independent live wallet/funding/cashout acceptance, fresh sealed production mainnet state/registry, final coordinated SQL/operational evidence and the owner's launch/funds decision. These synthetic transport checks do not establish live settlement or authorize mainnet activation.

October 2 composed browser graph `70f202348f000c5a86cf16f3dfe99d58d31c6bb7`
passed the canonical npm 11.19.0 / Next 16.3.6 production build (48 static pages)
with synthetic matching mainnet profile, registry and withdrawal-window pins.
`npm run test:browser-mainnet-normal-built` then exercised the actual emitted
Turbopack worker/bootstrap/chunks under the generated CSP: 271 requests with real
Chromium and IndexedDB, authenticated challenges, dual owner/session proofs,
retained nonce/cap state, logout recovery and expired-owner cashout. The wrapper
restored the source TypeScript configuration. This records the assembled browser
graph; subsequent script-only headless acceptance and whole-release CI/review
remain separate. No live funds or production mainnet activation were used.
