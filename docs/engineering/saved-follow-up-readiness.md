# Saved follow-up readiness before paint

ResearchChat reports preparation readiness in a layout effect. The saved report's
external target controls then reflect the committed streaming and owner state
before the browser paints, including restoration after a terminal event or Stop.
The callback remains a presentation signal. Existing current-state, owner,
visibility and document checks still refuse queued replacement drafts; readiness
does not authorize a research request, payment or credential delivery.

Main run 42391652298 failed the unchanged saved-target privacy test because the
target was enabled immediately after Stop research became visible. A bounded
regression uses the installed production React profiling renderer and the actual
chat. Its commit callback records readiness before passive effects: the previous
source reports a stale `true` in the first streaming commit, for example
`[true, false]` instead of `[false, false]`.
The test also observes target controls in animation frames, queued reselection,
terminal success/error, Stop and confirmed owner changes across visibility modes.
The regression does not patch the scheduler or React's effect implementations,
and adds no delay or retry to the original assertion. These synthetic browser checks make no live research,
payment or independent usefulness claim.

The failed historical main run remains failed. Any correction is bound to its new
accepted source and exact-main checks; a skipped callback after failed CI is not
publication acceptance. No request body, server/storage/receipt schema, signing,
budget or settlement rule changes, and retained reports are not backfilled.
