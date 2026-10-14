# Personal history on the verified SQLite deployment

The selected application facade now exposes the existing owner-attributed history
projection through a non-enumerable frozen `personalHistory` port. Both writable
and read-only verified application connections can read it. It creates no tables,
changes no flags, and does not update queries, payments, enrollment or custody.

The native constructor requires an actual verified connection. Each operation
checks its held file, pinned deployment, identity, fences and admitted schema
before and after reading. A refused native assertion permanently refuses that
port instance. Raw/ordinary connections cannot acquire native authority; the
ordinary constructor retains its enrolled-storage refusal.

The SQL projection, input limits, owner comparison, provenance parsing and
receipt fields remain shared with the existing ordinary implementation. Prepared
and cancelled-unexposed payment originals remain excluded from receipts. Receipt
access still requires the existing caller to prove research ownership; the port
does not grant a session, key scope, payment authority or a public history lookup.

The existing `/api/me/history` and Browse view use this port without a new API.
The separate owned-history and export flows still require their privacy/ownership
ports; this change does not fabricate them. Source and isolated native acceptance
must be followed by required CI and the coordinator's next combined deployment
before claiming the current production history failure resolved.
