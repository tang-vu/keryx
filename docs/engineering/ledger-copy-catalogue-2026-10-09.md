# Ledger copy catalogue correction

PR347's retained testnet presentation added 44 literal copy occurrences that
the required UI copy guard correctly rejected. This followup moves that new
history view and the directly added/changed dashboard labels into 37 typed
English keys in `lib/i18n/messages.ts`. It introduces no baseline allowance and
preserves every prior catalogue value. The old dashboard copy outside that
increment remains part of the broader issue272 migration.

Both components explicitly select English. Existing numbers, exact micro-USDC
formatters and `test USDC` denomination, wallet/source identities, network labels,
status values, dates, explorer/dispatch links, controls and CSS remain. A missing
period date contributes empty text, matching its previous React interpolation.
The original qualification and owner-operated/testnet cautions are unchanged.
Catalogue interpolation produces plain text; React still escapes supplied values.
No translated interface or human approval of financial prose is activated.

The web ledger, historical page and shared Proof history presentation use these
keys. The API/archive projection, current storage, settlement/authorization,
portable receipts, CSV, hosted and stdio MCP, CLI/Operator, desktop native graph,
extension and bots have no contract changes. Existing page handoffs reach the
same English UI. This correction adds no package version, installer, migration,
custody, schedule, provider request or spending authority.

Local source checks used the available Node 24.12.0 and the unchanged accepted
dependency backing. The retained before/after guard captures show actual exit 1
for the 44 new literals, followed by actual exit 0. The source inverse restores
both canonical pre-correction components, including their original templates,
and confirms the other code is unchanged. All 19 guard regressions, all 6 existing
typed-catalogue cases, app TypeScript and scoped lint passed with actual process
exit 0 and both output streams ending. No visual equivalence, production build,
deployed readback or published/installed distribution result is inferred from
these checks. Exact-source main CI and the coordinated deployment remain release
acceptance; source review and the owner's dated CI waiver are separate from those
results. Broader issue272 remains open.
