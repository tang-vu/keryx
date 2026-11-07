# Unsaved workbench navigation

Literature review focus, screening editors (including hidden filtered cards), and
Evidence Draft author inputs already tracked unsaved changes for native reload
and close. Next client links could previously unmount those editors silently.

`useUnsavedNavigation` shares one document capture listener across dirty editors.
Ordinary same-origin, same-tab links that change the path or query require discard
confirmation before Next handles the click. Cancellation preserves the editor
and the retained baseline. Save, exact revert and unmount remove their registration;
failed saves and inputs excluded from a draft JSON backup remain protected.

The registry keeps only editor tokens and fixed UI copy. It never stores, sends or
automatically saves private text. Consent applies to one click and the registered
editors at that moment. An accepted native link avoids a duplicate unload dialog;
a prevented client transition does not exempt later reloads. Modified clicks,
downloads, new windows and same-document links keep their existing behavior.
External same-tab departures retain the browser's native unload warning.

The research composer uses the same guard for a nonempty question after a user
edit or an explicit draft restoration, including a rejected question reopened
for review. Submitting or clearing the question disarms its registration; another
edit or restoration rearms it. An untouched shared-link prefill does not count
as an edit. Existing wallet/revision binding hides an old owner's draft and
immediately removes its warning. This adds no draft persistence or automatic Ask.
During a same-owner context recheck, the field may be temporarily hidden but its
generic dirty registration stays active until the verified identity changes.

This guard covers clicked anchors and native reload/close. It does not intercept
browser Back/Forward, programmatic client routing, process crashes or browser
termination; those need separate recovery design. Evidence Matrix retains its
existing recovery and navigation handling. No API, CLI, MCP, extension, payment,
storage format or publication contract changes.

Discard consent uses the authoritative English catalogue; machine previews do
not introduce unreviewed consent translations. Browser regressions exercise real
components, native link/reload behavior, independent dirty editors, failed saves,
retained JSON baselines and mounted/unmounted cleanup. Built Next workflows also
cancel actual internal links at 320, 390, 768 and 1440 pixels. All fixtures are
synthetic; provider and payment requests remain disabled or intercepted.
