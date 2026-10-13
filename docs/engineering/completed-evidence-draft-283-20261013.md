# Import a completed private read into an evidence draft

The browser evidence workspace can now select an already completed private job
and import its retained excerpts. Selection and import are separate explicit
user actions. Nothing is fetched on mount or by polling. The job belongs to the
current cookie-authenticated owner; an API key, bearer token, request body, Host
or forwarded header supplies no private-result authority.

The metadata and import POST routes require the configured origin and exact
expected owner before accessing private storage. They use only the existing
intent, execution, interruption and completed-result reader ports. The execution
reader retains its owner-bound incoming-settlement requirement. A second bounded
capture compares the entire intent, worker claim, saved time and serialized run
before disclosure. Missing, interrupted, replaced, foreign or timed-out results
refuse; there is no fallback, repair, source fetch or financial write. Responses
are private/no-store, selectors stay in the POST body, and errors omit private
storage details.

The selection binds the exact completed snapshot digest and original request.
Each imported excerpt must match a currently included paper's exact source,
item URL and content version, plus its retained citation, answer contribution,
read decision and receipt/body-hash or web provenance. Both existing asset-version
and public raw/normalized hash representations keep their own bytes. Seed,
synthetic and incomplete records cannot acquire factual or payout authority.
Missing provenance remains unknown; explicitly unusable retained evidence remains
unavailable. Neither is silently labeled unread. Semantic support and expert
judgments remain unmeasured.

Imports append to the current editor after the asynchronous read, preserving
passage, notes, themes, unrelated observations and unfinished statement edits.
Duplicate reports, capacity excess and contradictory observations refuse. Only
admitted retained excerpts clear related observations. Clear draft remounts the
selector, aborts old metadata/import requests and discards late responses even
when a transport ignores abort; a fresh explicit selection and import remain
usable. Assembly and export remain separate author actions. Markdown, LaTeX,
BibTeX and RIS retain the existing citation/reference parity checks.

The original generation worktree and its evidence are preserved. The completed
reader worktree contains the exact original seven dependency copies followed by
the reviewed reader, selector, mounting and Clear corrections. Request-local
saved-ledger provenance is distinct from portable editable/downloaded/reimported
reports, which keep caller-supplied origin. CLI, remote/stdio MCP, extension and
bot draft tools retain that role; this increment adds no API-key access to
private jobs. Desktop webviews use the same browser flow. No engine, payment,
source payee, receipt, nonce, custody, provider or financial state is changed.

## Validation on October 13

Focused checks passed 152 synthetic cases: retained-ledger adapter 60, private
HTTP/importer 35, owner selection 31, mounted workspace/Clear 22 and editor 4.
Focused TypeScript, including both new route imports, passed. The initial
adapter fixture omitted mandatory quote spans; it now uses the existing
fixture-only offset helper. Production guards and assertions were preserved.
The other 92 passing cases were reused, and the 17 unchanged generation cases
retain the earlier root-owned result. No provider, live private database,
model, paid read, purchase or expert judgment was executed.

The historical native CLI test-startup and Git-index refusals remain recorded.
They did not establish runtime acceptance; the later ordinary root-delegated
focused checks above are separate results. Required PR aggregate/domain CI and
its production-build/browser gates remain required. Original issue 283 stays
open for genuine expert/reference-section assessment and applicable delivery;
coverage, usefulness and unsupported-statement metrics remain UNJUDGED/null.
The coordinator owns main merge and the next combined deployment. This feature
does not activate a schedule or permit new spending.
