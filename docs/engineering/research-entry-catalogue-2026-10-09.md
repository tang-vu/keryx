# Research composer English catalogue adoption

Issue [272](https://github.com/tang-vu/keryx/issues/272) remains open for the other
interface areas. `AskForm` now uses the existing typed English catalogue through
the `researchEntry.*` namespace. This is the first actual composer adoption of
the locale foundation, rather than another exception baseline.

The selected interface remains English. Labels, placeholders, accessibility
names, mode descriptions, examples, availability controls and payment/privacy
notices retain their original wording. Named parameters retain the exact Arc
network label and existing six-place source-budget display. Payment/consent prose
is moved verbatim; this does not approve a translation or revise payment policy.

Question text, example question payloads, fetched model labels/notes and the
shared research-availability messages remain data or their existing contracts.
No locale preference, routing, cookie, provider, signer, budget calculation,
submit callback, source selection, receipt, stored answer or API wire data changes.
The browser-safe catalogue has no server/environment import; existing server and
client component boundaries remain unchanged.

Only this component's 43 obsolete copy-guard occurrences are retired. The
baseline source provenance and every other allowance remain unchanged. Readding
inline composer English now fails the existing guard. A future area migration
must similarly retire its own obsolete allowances instead of refreshing all
legacy findings.

`ResearchChat` uses this component for the home and `/research` entry and their
conversation turns. The compact embed has a separate composer and is not migrated
here. Desktop's hosted web view inherits it after deployment; extensions,
standalone CLI, API, both MCP transports and bots retain their current text/data
contracts. They gain no locale or payment capability from this migration.
Coordinated release and deployed/installed acceptance belong to the release owner.
This source increment has no separate version bump, deployment or issue closure.

Validation passes the full copy guard, 15 existing typed-message and real
Chromium availability/budget cases with synthetic intercepted transport, app
TypeScript and scoped lint. Static source qualification binds catalogue values
to the original literals/interpolations and preserves callbacks, state, classes
and other controls. An optional before/after DOM harness failed at fixture setup
before any comparison; its failure is retained and is not parity acceptance.
