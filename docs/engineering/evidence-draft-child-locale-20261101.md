# Draft restore and completed-result messages across locale changes

Switching interface language while a backup, saved metadata or private result is
being read could leave the completion message in the previous language. The
account/focus listeners also retained the language from their initial mount.

The three child controls now retain a typed status identity and resolve its
authored copy during rendering. Changing language updates a pending or completed
message without restarting a read, replacing the current draft or invalidating an
otherwise valid selection. Authored leaves use the existing language/direction
renderer, so unavailable preview text remains explicitly English inside Arabic.
The restore count summary follows the language of its authored template. Backup
titles, filenames and passages have independent original-text boundaries, and
private job IDs remain literal left-to-right input.

The change is confined to browser rendering. File/response byte limits, explicit
read/import actions, context and owner invalidation, timeouts, aborts, saved
snapshot/version/capability checks and current-editor append behavior retain
their existing implementation. The API, report/export formats, CLI, remote/stdio
MCP, native desktop, extension and bot contracts are unchanged. The desktop's
handoff to the web editor receives the web change after coordinated deployment.

## Validation

Eight new mounted regressions failed against the original source. They cover
delayed file refusal and stale-context completion, retained auth listeners,
metadata refusal/timeout, private import refusal, fallback direction and literal
job IDs. After the repair, all eight and the 25 existing mounted selection cases
pass. The 138 existing restore, selection, import and route cases and three
Chromium restore cases also pass; these exercise owner changes, malformed input,
bounded reads and preserving current edits.

A further 27 Chromium cases use production CSS and the actual child components:
all 13 prepared locales at 320 and 1366 pixels, plus Arabic at 320 pixels with a
32-pixel root font. A separate case checks Tab navigation, visible focus and
Enter/Space activation of restore, metadata read and import. They check explicit reads, refusal messages, accessible
control names, button text bounds, page overflow, original data and successful
restore without storage writes. The 27 retained screenshots contain nine unique
RGB images; each unique image was visually inspected, including unscaled strips
covering the enlarged Arabic image. Native file inputs can abbreviate filenames;
the separate preview retains the complete filename. Screen-reader behavior was
not manually tested.

The copy guard passes. Scoped lint has no errors and retains the three existing
effect/ref warnings. Full exact-candidate CI, TypeScript, production-build and
applicable platform/domain checks remain required before merging. Local checks
do not establish hosted acceptance or production delivery.

No new translations or human approval are provided. Existing partial-preview,
critical-copy and glossary gates continue to apply.
