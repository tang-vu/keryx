# Private browser checkout

The current production pilot purchases through the CLI. The browser already displays
owner-scoped private history and results. Browser purchasing remains work in progress.

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
Retention, explicit deletion and recovery guidance still need UI integration.

## Verification and next integration

`npm run test:browser-private-journal` bundles the real modules for Chromium and uses
unfunded synthetic EOA signatures. All HTTP is intercepted. It checks browser/server identity,
exclusive reservation, signature/owner/merchant binding, two-tab submission contention,
reload, recovery-only imports, export, pagination, unavailable storage, transaction abort
after a write request, and corrupted data. This is not a live wallet or Circle acceptance run.

Next: quote and provider review with independently retained terms; current SIWE/wallet/chain
and Gateway-balance checks around signing; one bounded private POST; recovery from the
original journal after any uncertain response; accessible browser controls and manual wallet
acceptance. Purchase availability remains constrained by the server's pilot allowlist.
