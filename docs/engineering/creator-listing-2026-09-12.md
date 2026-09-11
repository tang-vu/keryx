# Creator listing authority, September 12, 2026

The previous listing GET checked cached payout/author membership before reading the
registry. A registrant with a separate payout wallet consequently received 403 even
though SourceRegistry grants update/deactivate authority to its stored creator.
The reproduction called the actual route with a synthetic authenticated creator and
source; it observed 403 and no registry read. No real source or wallet was changed.

The route now authenticates first, reads the configured registry and compares its
creator with the session address. Only that creator gets on-chain management terms;
payout recipients and split authors do not acquire registration authority. Read and
write registry addresses must match. Missing records or RPC errors withhold terms.
Offline listing rules remain unchanged, and POST cannot mutate an on-chain source.

The existing browser panel now requires the creator account on Arc Testnet and pins
both contract calls and receipt reads to that chain. A receipt with reverted status
is reported as reverted, not as success merely because the RPC query completed.
Successful receipt feedback prompts a registry refresh, without asserting that the
indexer already reflects the write. Arc's [official RPC reference](https://docs.arc.io/arc/references/rpc-endpoints),
checked September 12, still identifies testnet as chain 5042002 and reserves mainnet
parameters for separate publication. No RPC configuration was changed.

Validation: route tests cover a separate creator/payout, payout and author rejection,
anonymous access, unavailable/missing registry, differing registry configuration,
on-chain POST refusal and preserved offline permissions. Chromium runs the actual
React panel with synthetic API/wallet providers: wrong/disconnected wallet and wrong
network block both actions; update/deactivate pin account and chain; revert cannot
produce success feedback. These tests perform no signing or settlement.

This does not establish independent creator onboarding or funded mainnet acceptance.
Global account source discovery still uses cached payout/author membership. Existing
contract updates replace the complete record; concurrent edits, transaction replacement
and durable recovery require further work. RPC, authenticated session and browser
integrity remain trust dependencies.

## Pre-prompt freshness, v0.22.63

Before either wallet action, a fresh GET (ten-second timeout) must match the displayed
registry, source ID, creator, active state, price, payout, ordered author splits,
content reference and tags. Schema checks preserve uint64 price, address, split and
UTF-8 contract limits. A difference updates the visible details and requires another
deliberate action. No automatic retry or signature follows a change or read failure.
The panel rejects a wallet/source identity change while awaiting the read and locks
concurrent actions before the first asynchronous step.

Unit cases cover each changed field and malformed snapshots. The Chromium check
changes the payout after page load and verifies zero write requests, visible review
of the new payout, then a subsequent intentional write using that payout. It also
withholds writes on unavailable authority and an account change during a delayed read.
All wallets and API responses in these tests are synthetic.

This is not atomic compare-and-set. Another edit after the read, including while the
wallet prompt is open, can still race a full-record update. The UI states this limitation.
Removing that window requires a contract revision and migration; no deployed contract
or payout was changed by these checks.
