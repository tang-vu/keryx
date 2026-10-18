# Wait for short SQLite writer locks during reader admission

A new verified connection performed identity, fence and schema reads before
installing its existing five-second SQLite busy timeout. A short native writer
lock could therefore refuse a fresh reader immediately as `storage_unavailable`,
even when the writer released promptly. Configure that same connection-local
timeout immediately after opening the native handle, before admission reads.

Every target, runtime, identity, fence, schema and application-SQL check remains.
Read-only handles remain read-only; the timeout grants no application PRAGMA
capability, performs no schema repair and adds no target-admission cache. Writes,
journal mode, credentials, custody, limits and financial authority are unchanged.
Locks lasting beyond the existing bound can still refuse service.

## Verification

A genuine isolated SQLite worker holds an EXCLUSIVE lock for 500 ms while a new
read-only verified connection opens. The original source failed with
`storage_unavailable`; the correction reads the retained row after release,
continues to refuse writer authority and leaves database bytes identical.
The native policy, storage identity and enrolled adapter suites passed 49 tests;
one existing inode replacement test requires non-Windows filesystem semantics.
All fixtures are isolated, offline, with no provider or payment operations.
This reproduces a connection-admission defect; it does not establish the cause
of every historical production error or measure a general latency improvement.

## Supported surfaces

The shared enrolled connection is used by hosted web/API research, remote MCP,
workers and CLI/Operator operations that select enrolled SQLite. They receive
the correction through their actual deployed or locally checked-out source.
The web locale and research-plan fixes are separate outcomes in the same release.
The stdio MCP adapter delegates hosted research; it does not bundle this database
connection. The desktop local helper and packaged source graph must be audited
by the release owner before claiming that an existing installer contains the fix.
The extension and bot adapters retain their established hosted handoffs and
authorization. No binary, package publication or installed-source alignment is
claimed by these local tests.
