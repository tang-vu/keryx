# Public research history and creation visibility

The owner approved the revised product policy on October 15: ordinary research is
public by default, with its visibility shown before submission. Explicit private
and unlisted choices, saved account preferences, erasure and the separate private
research pilot remain authoritative. Signing in alone does not make research
private. This supersedes the October 12 blanket historical-unlisted policy.

The production diagnosis on app 0.27.67 found 156 retained originals and no privacy
sidecars or visibility audit rows. Missing historical metadata resolved to unlisted,
so every public listing was empty. No recorded original was erased. Of these records,
99 have canonical Arc mainnet network evidence and 57 remain unattributed; restoring
visibility must never manufacture network, cohort or outside-user provenance.

Historical restoration is an operator action, separate from application startup and
new-question defaults. Review every candidate's original and related public
projections for sensitive material and private-job references. Record an allow or
exclude decision against exact original bytes. Apply only approved missing sidecars
in one guarded transaction; a changed original, new explicit sidecar, visibility
audit or erased record aborts the operation. Preserve financial rows, original JSON,
saved defaults, existing audits and all excluded records. No implicit backfill on
read, resave, deployment or startup is permitted.

New questions capture a validated creation visibility before research starts and
persist the original together with its initial visibility. A requested private or
unlisted result cannot briefly appear as public. Private questions require an
authenticated owner for later access. A follow-up inherits a hidden parent's
visibility and cannot expose that context through a less restrictive choice.

The ledger must distinguish the complete public question population for the selected
network from recorded activity across the retained database. A 50-row history page
is a sample, not the public count. Unknown networks remain unknown, scripted runs
remain excluded by their recorded classification, and unavailable reads must not
be displayed as zero. Existing settled payment totals keep their original meaning.

The focused source outcome requires storage, ingress and UI failure-path checks,
independent review and required CI. ROOT owns protected content review, the exact
production restoration slot, final-main checks and one combined deployment. No
new funding, custody, spending authority or autonomous schedules are introduced.

The operator CLI is `node --import tsx scripts/restore-public-research.mts`:

- `export --out <protected-review.json>` captures the current verified native store.
- `dry-run --review <protected-review.json> --decisions <review-decisions.json> --out <plan.json>` binds every decision to the original and related evidence.
- `apply --plan <plan.json> --expected-plan-sha256 <sha256> --out <result.json>` applies the exact reviewed plan once.

Use the existing selected storage manifest, with no target scanning, bootstrap or
schema installation. Files are exclusively created with mode 0600; bounded
protected inputs remain operator-only. Ordinary recovery references require the
separate exact-projection review and `recoveryReviewed: true`; private-job references
are always excluded. A changed original or related record requires fresh review.
Failures emit bounded codes without source text. An unverified apply outcome must
be inspected against retained output and database state before any retry.

Creation visibility is browser request metadata and a privacy sidecar, not a new
stored `QueryRun` field or settlement claim. The embed offers deliberate Public
creation and links to the full app for hidden research. Paid agent/chat APIs,
CLI, bots and MCP retain their existing input contracts and consume the shared
storage default; the separate private-job contract is unchanged. Desktop inherits
the guarded browser UI. Existing public readers and revocation checks remain the
authority on every surface. `/api/ask/visibility` returns the verified browser
context and `/api/runs/summary` supplies the complete bounded public population;
the recent question page supplies examples rather than a total.

Release source reserves app/OpenAPI 0.27.68, stdio/npm/Registry MCP 0.4.23 and
Desktop 0.4.21. Hosted MCP retains protocol identity 0.3.18; extension 0.1.4.2
retains its shipped inputs. These are source identities, pending final-main
acceptance and verified deployment/publication. They do not assert owner installation.

| Surface | Publication behavior |
| --- | --- |
| Web and desktop browser | Show creation visibility before submission; bind hidden drafts and results to the verified owner. |
| Embed | Require a deliberate Public choice; hand hidden research to the full app. |
| Browser API | Validate requested visibility, expected owner and hidden-parent restriction before inference; verify active writer readiness. |
| Paid agent/OpenAI/A2A API | Preserve request/payment contracts; ordinary first saves consume the shared saved-default/Public policy. Internal insert-only recovery retains its separate trigger policy. |
| Remote and stdio MCP | Preserve tool inputs/scopes and guarded public/owner readers; ordinary persistence uses the shared policy. |
| CLI and bots | Preserve caller authentication, payment and private delivery roles; ordinary persistence uses the shared policy. |
| Extension | Existing browser handoffs expose the web choice; paid API requests retain their current contract. Verify unchanged shipped bytes before retaining its version. |
| Private jobs and Operator custody | Existing private stores, funding limits, execution holds and custody authority remain authoritative. |
