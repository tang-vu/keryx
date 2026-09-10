# Private browser checkout

The configured testnet pilot can review and purchase private research in `/research`,
using the same owner-only server admission as the CLI. General availability is not enabled.
The browser also displays private account history and locally retained recovery entries.

## Purchase and recovery

Sign in with the paying EOA account, enter a question, creator cap and maximum total, and
choose **Review private price**. The difference between maximum total and creator cap bounds
the service fee. Review the actual total, merchant, provider/model/endpoint and non-refundable
best-effort terms. Accept the plaintext local-storage disclosure before buying. Gateway funding
uses the existing bounded wallet funding controls and is separate from purchase authorization.

Immediately before signing, a fresh available quote must match the reviewed terms exactly.
The client checks the current session, wallet, Arc chain and Gateway credit around signing.
The signed intent is retained before a single private POST. A lost or invalid response leads
to recovery of the same job. Local imports, exports, history and recovery cannot initiate a
new payment. No private selector is placed in a URL. A new purchase requires another explicit
review; it is never the recovery mechanism for a previous purchase.

The server-reported result is checked against the original question, package/model, budget,
total and creator ledger. This is not a portable cryptographic receipt or chain-finality proof.

## Implemented journal boundary

`lib/buyer/private-browser-journal.ts` uses a separate `keryx-private-buyer-jobs-v1`
IndexedDB database. It does not sign, fund wallets or issue HTTP requests.

1. Reserve a validated unsigned draft exclusively before invoking the wallet.
2. Validate and save the first signed intent against the exact reserved draft; read it back.
3. Atomically change `signed` to `submission_possible` before the one HTTP attempt.
4. Reload, response loss and imported recovery files use read-only recovery, never new
   salt/nonce generation or another submission. An imported intent cannot acquire a claim.

Every read checks the payer, independently supplied merchant policy, original request
commitment and available signature. The same canonical job identity and EOA proof are
checked in Node and Chromium. A reservation is not a paid job. The submission marker is
not settlement evidence. Database rejection, a changed row or a failed read-back cannot
grant submission permission. Server admission remains the global replay/payment authority.

Account-scoped local pagination includes unsigned reservations, which server history cannot
recover because they were never submitted. Explicit export returns the existing signed CLI
intent format. It does not refresh validity or claim portable proof of settlement.

## Privacy and lifecycle limits

The browser journal and exported file contain plaintext question text, salt and a bearer
signature. Same-origin scripts and someone controlling the browser profile can access them.
Do not describe this storage as encrypted. The UI must obtain clear local-storage consent
and offer export only on an explicit action. Do not put job identifiers in URLs or telemetry.

Browser eviction, profile deletion and device loss can remove the local journal. A successful
IndexedDB commit does not establish disk/power-loss durability on every browser or device.
Deleting local data cannot cancel an authorization, remove the server result or release funds.
Choose **Delete local private data**, then confirm, to remove a job's stored question,
salt and signature from the local journal. Export first if you need a portable recovery
copy. A minimal account/job marker remains to block another local submission. It is
omitted from local recovery lists. Importing a validated backup restores recovery only.
Deletion clears this checkout's displayed result and draft; it does not cancel an
authorization or in-flight request, refund funds, remove account/server history, clear
other open tabs or erase exported files, backups or disk remnants. Close other tabs to
clear their displayed copies. This is not secure disk erasure. Corrupt journals remain
fail-closed rather than being silently overwritten. Server retention and automatic local
expiry remain separate work.

## Verification and next integration

`npm run test:browser-private-journal` bundles the real modules for Chromium and uses
unfunded synthetic EOA signatures. All HTTP is intercepted. It checks browser/server identity,
exclusive reservation, signature/owner/merchant binding, two-tab submission contention,
reload, recovery-only imports, export, pagination, unavailable storage, transaction abort
after a write request, and corrupted data. This is not a live wallet or Circle acceptance run.

`npm run test:browser-private-checkout` exercises the actual React/client/IndexedDB path with
synthetic EOA signing and intercepted HTTP. It covers unavailable pilot accounts, consent,
review, response loss followed by recovery, reload/export, changed session/wallet and layout
at mobile and desktop sizes using the application CSS. Funding is separately tested by the
existing browser funding suite. No live payment is made by these checks.

Still required: independent wallet-extension/mobile acceptance, a live browser private paid
pilot, server retention and portable private receipt verification. Purchase
availability remains constrained by the server's pilot allowlist.
