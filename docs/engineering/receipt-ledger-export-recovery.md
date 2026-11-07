# Reference exports with unavailable claim metadata

Checked-receipt exports preserve independently validated citations when the
optional `claims` ledger is absent, unsupported or exceeds its existing bound.
Previously a malformed claims section caused the joint read-model parser to drop
the valid citation section as well, silently emptying BibTeX, RIS and CSL exports
after successful receipt recovery.

The claim array is validated separately with the same 256-row limit. Unsupported
ledgers remain unavailable: no targets, excerpts, coverage or factual assessment
are invented from the citations. A supported array still uses the existing
per-row claim/evidence schemas and exact article/version/marker checks. Existing
64-citation admission and refusal behavior remain unchanged.

This application export projection runs after the original receipt digest,
request, answer, package and financial caps are checked. It never rewrites or
re-seals a received receipt, journal or saved result. Core TypeScript/native
inspection, payment classification, signing and recovery authority are unchanged.
The private Operator/CLI/desktop exports can retain reusable references while
the original answer, digest and seller-reported settlement qualifications stay
intact. Existing API/MCP roles, schemas and report-link handoffs remain unchanged.

Regressions construct controlled unsupported receipts before their integrity
check, exercise GET-only recovery/save/offline reopen, and compare original file
bytes. They retain the existing citation bound and the supported 256-claim edge,
including refusal of an invalid individual row. These tests establish read-model
fidelity; they do not authenticate a publisher or prove real settlement or useful
research.
