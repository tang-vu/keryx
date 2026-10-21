# Export the displayed ledger observation

The public ledger previously linked its download buttons to a fresh API read.
If the observed records changed after rendering, a reader could see populated
books but download an empty or different ledger. The real Chromium fixture
reproduces this by changing the server cohort before clicking CSV export.

JSON and CSV downloads now serialize the already validated, WebCrypto-checked
snapshot held by the view. Both formats retain its original network, window,
capture times, exact integer amounts and digest, with no new ledger request.
The existing deliberate browser-text download helper handles the local file.
The browser and Node exporters share pure text serialization; the public Node
entry points still perform the same binding and digest verification first.
CSV columns, quoting, formula protection, CRLF and canonical JSON are unchanged.

Rendered tests preserve current loading, period/retry cancellation, errors and
recovery. The actual Chromium gate checks both downloaded formats while the
server holds a different cohort, unchanged WebCrypto validation, responsive
functional checks, tamper refusal and empty-cohort recovery. Its fixtures are
synthetic and loopback-only, not funded production or full CSS qualification.

Issue286 remains open: this improves retention of the public observed-transfer
ledger, without adding invoices, revenue attribution, obligations or per-job
profit. API, CLI and remote/stdio MCP keep their existing formats and read roles;
desktop, extension and bot handoffs retain the same contracts. No settlement,
payment, storage, authority, feature-activation or version changes are made.
Required PR/domain CI and Circle-owned batched delivery remain separate gates.
