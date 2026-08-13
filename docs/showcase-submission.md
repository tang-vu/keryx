# Arc Showcase submission draft

Run `arc-canteen submit-showcase` interactively. The command asks the project owner to affirm that
the live site will stay live and the repositories will remain open source; those commitments must be
made by the owner, not by automation.

## Links

- Main repo: `https://github.com/tang-vu/keryx`
- Live site: `https://keryx.cc`
- Standalone primitives: `https://github.com/tang-vu/keryx-arc-primitives`

## Pitch

Keryx is a citation-toll reading agent: it discovers exact article versions, explains BUY/SKIP/CACHE
decisions under a hard budget, pays x402 access tolls, synthesizes evidence-qualified citations, then
settles exact weighted USDC rewards to the creators it actually cited.

The reusable Arc primitives go beyond a demo transaction: a creator-owned SourceRegistry with
integer prices and multi-author splits; browser session-key co-signing with an economically hard
funded cap; server and browser payee verification against on-chain authority; exact micro-USDC split
allocation; settlement-state handling that keeps ambiguous submissions pending and reconciles them
by EIP-3009 nonce; post-settlement delivery failure containment; and encrypted IPFS/DB content that
is released only after x402 settlement.

Other Arc builders can fork the standalone primitives or lift the focused modules and threat-model
tests from the main repository. The live `/proof` dossier links the deployed commit, CI, Arc RPC and
registry parity, Circle wallet-balance parity, independent-vs-first-party usage, and real creator
withdrawal transactions—along with the limit of what each evidence layer can prove.
