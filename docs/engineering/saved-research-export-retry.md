# Saved research export retry feedback

Recovery exports use the existing verified local journal and recovery encoder.
A failed export previously left its alert visible after a successful retry. An
older export could also replace a newer view's error state, hiding the newer
failure. A synchronous browser download initiation error escaped the promise
rejection handler without showing export feedback.

Local export and removal attempts now have separate feedback channels. Each
channel accepts failures only from its latest attempt in the current selected
view. Selecting, reopening or closing a view revokes older feedback contexts;
refreshing the saved list preserves the selected view. Starting another export
clears that export's previous error without clearing a failed local removal.
Download initiation is inside the same error handler as journal export.

A requested export may still finish after the user changes selection. Its
payload remains the originally selected journal and its filename remains
`keryx-recovery.json`. The browser manages later save/cancel outcomes; accepting
download initiation does not prove a file was saved on the user's filesystem.

The browser regressions use minified production React components, genuine
IndexedDB reads and aborts, and actual browser downloads checked against the
unchanged recovery encoder. A controlled native download initiation exception
exercises its failure path. Both original journals must remain byte-identical;
observed recovery traffic is same-origin GET only. No journal validation,
receipt, submission, signing, payment, budget or local-removal storage effect is
changed. Existing import ordering and conditional removal completion remain in
force.
