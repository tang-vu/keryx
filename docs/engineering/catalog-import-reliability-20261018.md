# Public catalog write reliability

The app0.27.76 catalog invocation completed with 56 of 59 publishers successful.
The arXiv cs.AI publisher reached the existing write deadline; Microsoft Research
and Rust reported write failures whose production causes were not recovered.
The runtime remained delivered. This change addresses two reproduced local write
paths without retrying that production invocation.

## Bounded term insertion

An isolated native0873 fixture used the cached 453-item arXiv feed and the reported
prior public counts: 58 publishers, 2,116 articles, 2,132 versions and 241,693 terms.
It retained the full verified connection guards and the existing 15-second
deadline. The unmodified writer refused after 18.17 seconds and rolled back the
publisher exactly. Its 233 term INSERT executions consumed 8.91 seconds, including
6.61 seconds in fresh connection guards. The later capacity scan had not finished.

The writer now accumulates each tuple's exact UTF-8 JSON bytes, including array
brackets and commas, and flushes before the existing 128 KiB parameter bound would
be exceeded. A batch also has a ceiling of 2,048 tuples. It still uses the same
parameterized SQL and invokes the verified statement guard for every execution;
it does not cache a successful guard or suspend storage checks. Every term and its
weight remain part of the same publisher transaction.

This is an execution batching change. The archive bounds remain 500,000 rows,
192 MiB raw/framed data, 256 MiB allocated file, 2 MiB per field and a 15-second
write deadline. Generic snapshot and enrollment bounds are unchanged.

## Writer reservation before reading

A deferred SQLite transaction can establish a WAL read snapshot, allow another
writer to commit, and then fail its own write upgrade with `SQLITE_BUSY_SNAPSHOT`.
That race was reproduced locally; it is not established as the cause of either
Microsoft Research or Rust's production error.

The two mutating entry points now start `BEGIN IMMEDIATE` when they own the
top-level transaction, before reading their publisher snapshot. They retain the
existing publisher SAVEPOINT and commit or roll back only that owned transaction.
The verified connection's 5,000 ms busy timeout and all guards remain unchanged;
waiting for the reservation consumes the existing write deadline. There is no
automatic retry or new public error contract.

An already active caller transaction keeps its original mode and ownership.
Publisher failure rolls back only the nested SAVEPOINT, preserving unrelated
outer writes. A caller that established an older read snapshot remains responsible
for its transaction mode; this function does not silently restart it. Read-only
page/count queries retain their existing snapshot behavior, and the explicit
schema installer still follows its existing migration path.

## Validation scope

Focused regressions cover exact multibyte JSON boundaries, normalized term weights
and idempotency, rollback after a later term batch writes, nested outer-transaction
preservation, and both top-level mutating entry points competing with a second WAL
writer. The existing concurrent read-only page/count snapshot test remains.

On the same immutable starting fixture and cached feed, one candidate invocation
added all 453 articles in 13.66 seconds. Term INSERT executions fell from 233 to
45; the complete capacity scan visited all 94 tables and accepted 304,501 rows,
75,789,395 raw bytes and 98,377,639 framed bytes. All 315 connection assertions
remained fresh. The result had 59 publishers, 2,569 articles, 2,585 versions and
299,283 terms, and its integrity check passed. The focused archive file passed all
46 cases, and the root TypeScript check passed.

These are local Windows measurements with synthetic native/financial rows, not a
production trace or a VPS performance guarantee. The cached feed has the same
item count as the failed production publisher; byte equality with that production
response was not established. The 13.66-second result leaves limited margin
under the unchanged deadline. Independent review and required CI remain release
requirements; no storage limit or deadline increase substitutes for them.
