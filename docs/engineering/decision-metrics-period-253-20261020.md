# Keep decision metrics bound to the selected UTC period — issue 253

The public decision-review metrics form allowed dates to change while leaving
the previous period's counts displayed. A pending read could also finish after
an edit and show counts for its old period under the new date controls. The
caption describes the selected complete UTC days, so this could misattribute
decision counts and agreement rates to a different window.

Editing either date now immediately removes the old counts and notices, aborts
the pending observation and permits a new explicit read. Editing does not fetch
automatically. A cancelled observation cannot display late success/error data,
or clear the busy state belonging to a newer read. The response still must pass
the existing bounded schema, cohort/count consistency and exact-period checks.

Seven real Chromium regressions fail against the previous component. They
exercise both date controls at 320/1280px, late success/failure after a new read,
and rejection of a response bound to another period. The fixture deliberately
ignores request abort to prove that a delayed response remains harmless. It
blocks outbound browser requests and uses synthetic aggregate counts only.
Existing route, owner, live-gate, exact-replay and private-response regressions
retain the surrounding contracts. Both TypeScript graphs, the default build and
applicable full PR/domain acceptance remain required on CI.

No verdict, classification policy, database, payment, review admission or API
contract changes. No new human or outside-customer evidence is claimed. Full
issue 253 remains open for its existing product/rollout acceptance; deployment
is handed to the existing coordinator's combined runtime batch.
