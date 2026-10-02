# Owner-operated creator cash-out batch

This explicit operator workflow uses the protected withdrawal engine for an
immutable, reviewed list of wallets whose original keys the owner controls. It
does not activate public withdrawal creation or a timer. Testnet cash-outs move
existing balances; they are not new creator payments or independent adoption.

The October 2 scope authorizes up to 23 eligible wallets and an absolute
55,000,000 micro-USDC debit ceiling on Arc testnet only. The current reviewed
snapshot is 54,959,260 micro-USDC, with quoted fee reservations of 88,550 and
54,870,710 micro-USDC of potential mint value. Those are an unsigned plan, not
settled figures. The controlled stale wallet with 2,000 micro-USDC cannot cover
the fee and is excluded. A current payout address without an inventoried key
remains outside custody; a matching source label cannot authorize it.

Each request pays the original owner. The signed amount plus the quoted maximum
fee equals that owner's reviewed available balance. Unsigned estimation runs at
most five times to reach this exact fixed point. Circle may charge less than its
quoted maximum, and later credits may accrue. Keyless recovery reports the fresh
residual separately; no zero-balance or exact fee claim follows from a quote.

## Authority and retained originals

The input manifest is public JSON:

```json
{
  "format": "creator-cashout-batch-manifest-v1",
  "network": "eip155:5042002",
  "maxTotalDebitMicros": "54959260",
  "maxFeeMicros": "3900",
  "owners": [
    { "owner": "0x...", "availableMicros": "...", "label": "Original label", "sourceName": "Original source" }
  ]
}
```

The sum must exactly equal the selected total; owners are unique and the fee cap
is 3,900 micro-USDC each. Preparation rechecks each balance and finite vendor/RPC
terms, saves the complete plan exclusively, and creates a private application
journal. It outputs `planSha256`. Independently review and retain that digest.
Every subsequent operation requires it, including original import and keyless
recovery. Structurally valid replacement plans do not inherit review authority.

Keys stay in their existing custody files. The signer derives the address rather
than trusting a keystore label. The separate publisher option reads exactly one
`KERYX_PUBLISHER_PRIVATE_KEY` field from the original env file, without loading
other settings or endpoints. Windows source custody permits the existing
owner/SYSTEM/Administrators ACL as privileged-host trust; new signed-artifact
directories permit owner/SYSTEM only. Actual DACL and ancestor replacement
rights are checked, including generic rights and reparse paths. Linux uses the
existing protected directory/file contract. No `0600` claim substitutes for a
Windows DACL. These checks observe protection; they do not change source ACLs.

One exclusive signing marker precedes each local signature. The exact original
must be stored and reread before it is exposed. An interrupted signing marker
without an original is inspection-only. Import validates the signature, reviewed
digest, draft identity, owner, recipient and copied policy before saving once.
Only public plans and signed originals travel between hosts; keys never do.

The batch binds one fresh Linux-only relay journal to its first submission.
There are exactly 23 nonce slots and an immutable lifetime ceiling of
207,000,000,000,000,000 native wei (0.207 test-native USDC) for this plan. Each
admission retains 9,000,000,000,000,000 wei, with 300,000 gas, maximum 30 gwei and
5 gwei priority. Actual gas below the ceiling does not release that reservation.
Other batch sizes derive slots and lifetime ceiling from their reviewed count;
the command cannot append owners or enlarge an existing relay policy.

The dedicated funding executable retains one exact 0.21 native test-USDC
transfer from the selected original Linux funder. Its 21,000 gas / 30 gwei terms
bound funding gas to 0.00063. This allocation includes the 0.207 relay lifetime
gas ceiling; they are not separate amounts to add. Fresh funder latest/pending
nonce and fresh relay custody/zero nonce are required. The older 0.010 rehearsal
funding helper and exhausted historical journals keep their original limits.

## Explicit commands

Run the checked source with Node 24 and installed dependencies. None of these
commands installs scheduling or implicitly loads `.env.local`. Private paths
are operator-selected existing protected parents; new directories are exclusive.
Prepare, sign and submit require reviewed `--max-ahead-blocks` and
`--max-processing-lag-blocks`. All paid execution stays on Linux; the owner
signer also supports the original Windows custody host.

1. Run `npm run creator:cashout -- --prepare --manifest PUBLIC_MANIFEST
   --directory NEW_PRIVATE_BATCH` with the two height limits. Review every
   owner, amount, maximum fee, finite expiry and the returned digest.
2. Generate and independently verify sole custody of a fresh dedicated relay,
   then run `creator-cashout-batch-funding.mts --prepare --directory NEW_FUNDING
   --rpc https://rpc.testnet.arc.network --recipient RELAY --expected-nonce N
   --key-env-file /root/keryx/.env.local --fresh-relay-custody-verified`.
   Review the retained hash and exact terms. Invoke `--send --directory
   NEW_FUNDING --rpc https://rpc.testnet.arc.network` once. Later `--recover`
   uses no key and cannot broadcast again. Prefix direct scripts with
   `node --import tsx`.
3. Use the existing withdrawal provisioner to verify current relay backing and
   initialize its new journal with the reviewed slot/lifetime terms. No
   production flag or service is changed. Retain the original dedicated relay
   environment and custody inventory privately.
4. Copy only `plan.json` to a fresh protected directory on each custody host.
   Invoke `npm run creator:cashout:sign -- --directory PRIVATE_PLAN_COPY
   --plan-sha256 REVIEWED_DIGEST --owner EXACT_OWNER --keystore ORIGINAL_FILE`
   with the height limits. For the original publisher key, replace `--keystore`
   with `--owner-key-env-file ORIGINAL_ENV`. The signer uses the official public
   Arc testnet RPC regardless of env-file endpoint text. Repeated invocation
   reads an existing original; an uncertain marker never signs again.
5. Transfer each retained original privately to Linux and run
   `creator:cashout -- --import --directory BATCH --plan-sha256 DIGEST
   --owner EXACT_OWNER --original RETAINED_FILE`. No key is transferred.
6. Explicitly load only the reviewed relay/operator runtime inventory and run
   `creator:cashout -- --submit --directory BATCH --plan-sha256 DIGEST
   --relay-directory EXISTING_RELAY --confirm-isolated-custody` with the height
   limits. This saves request and gas admission before the one Circle claim.
   Repeat inspection of existing claims cannot POST another transfer. Unknown
   Circle responses retain their original claims and gas; no new salt, expiry,
   signature or fee quote replaces them.
7. Run `creator:cashout -- --mint --directory BATCH --plan-sha256 DIGEST
   --confirm-isolated-custody` with the same isolated runtime inventory. Fresh
   per-request gas-estimation failures stay unqueued without blocking other
   eligible attestations. Existing slots are never re-estimated. A pass visits
   at most 16 originals; every raw broadcast consumes an exclusive marker after
   durable original transaction storage. An unknown broadcast is keyless
   recovery-only. A pending shared nonce can hold later slots; it is never
   skipped, replaced or released.
8. In a new process without signing keys, run `creator:cashout -- --recover
   --directory BATCH --plan-sha256 DIGEST`. It verifies the exact original mint
   event and operator-selected RPC finality and records cash-outs separately
   from payments. After completed predecessors are observed, another explicit
   bounded mint pass can process later unattempted originals. No automatic
   polling or paid retry is installed.
9. To publish verified rows into the existing production cash-out ledger, use
   the explicit recovery option `--public-db EXISTING_PROTECTED_APPLICATION_DB`.
   Its monetary identity comes from original matched observations, while display
   labels come from the reviewed manifest. Signed originals remain in the private
   batch journal. Idempotent readback prevents duplicate/conflicting monetary
   rows; neither revenue nor payment rows are written. Retain off-host backups
   of both original journals and review digests under the documented recovery
   procedure; an older copy cannot authorize renewed signing.

Exit 2 reports pending/unavailable legs, retaining their originals. Exit 1
reports a refused command or journal boundary. Unknown Circle response loss
before retaining a UUID remains the vendor-evidence gate in
[withdrawal recovery](../creator-withdrawal-recovery.md); this driver does not
close it or promise a repeated POST is safe.

## Supported surfaces and release evidence

This release adds owner CLI preparation, portable owner signing, explicit
funding and Linux relay/recovery. The deployed TypeScript engine retains payment
authority. Browser/API legacy withdrawal remains the demonstrated existing
boundary pending a separate protected migration; new browser workspace creation
continues behind its configuration gates. Desktop, CLI buyer, remote/stdio MCP,
extensions and bots receive no creator cash-out authority. Existing public
dashboard/proof/API feeds consume only verified cash-out rows.

Focused tests use unfunded synthetic owners and intercepted/synthetic vendor or
RPC behavior. They cover integer/fixed-point caps, immutable digest, owner-key
selection, original signing retention, actual Windows DACL refusal, failed gas
estimate isolation, one-broadcast uncertainty and existing journal refusal.
Funding has separate original/nonce/one-send/receipt tests. Linux permission,
application-store and CLI checks and full TypeScript checks are release gates.
Funded acceptance, residual balances and deployed/published versions must be
recorded from actual evidence after review and CI; none is inferred from tests.
