# Retained native completion response compatibility

The native failed-original verifier previously rebuilt a saved response using the
current A2A presentation constructor and compared the entire order. Adding derived
CSL exports therefore made an unchanged pre-CSL response fail native proof, even
when its original claim, exact run digest, evidence and settlement still matched.

SQLite verification now compares the complete modern order first. Only after
`validateFulfilledQueryRun` accepts the retained native result-v1/v2 and its
completion digest may it compare one complete pre-CSL expected order. That
presentation contains exactly `researchExports.bibtex`, `ris` and `evidenceCsv`;
if a validated bibliography exists, its separate companion exports contain exactly
the stored bibliography's projected BibTeX/RIS pair. All remaining order and
response fields use the same modern expected values.

The verifier never strips fields from the actual response, rewrites history or
changes its run, completion, claim, settlement or reservations. Changed money,
answers, evidence, versions, unknown fields, old exports, malformed/present CSL
and mixtures of the two presentation profiles fail exact comparison. New writes
retain modern CSL exports. PostgreSQL native fulfillment remains unsupported.

V1/V2 native protocols bind the whole run but did not stamp a response presentation
version. Consequently the exact absence of both derived CSL companions cannot
distinguish a genuine old response from removal of those derived companions from
a newer response. This deliberate compatibility boundary permits only that one
complete legacy shape; it is not an independent proof of its creation date. A
future independently bound presentation stamp would need a separate protocol
change. No other missing-field profile is admitted.

Disposable synthetic SQLite tests cover modern and legacy responses with and
without bibliography, unchanged read-only rows and idempotent completion, corrupted
financial/evidence/version/export fields, partial profiles, present CSL corruption,
and retained-run/claim/settlement refusal. A synthetic result-v2 case exercises
the enrolled read-only SQLite path with the genuine supplementary capability,
missing/counterfeit capability refusal and unchanged historical rows/settlement.
They use no private original, provider,
signer, shared database or real payment. Application and operations TypeScript,
focused tests and lint are source gates; exact CI, coordinated release and fresh
native original-proof acceptance remain separate gates. This fix neither deploys
source nor renews any historical execution authority.

All supported API, web, CLI, desktop, MCP, bot and extension presentations retain
their current contracts. The changed path is private native completion inspection
and idempotent SQLite completion readback; it introduces no new public endpoint,
adapter capability, migration or distribution version.
