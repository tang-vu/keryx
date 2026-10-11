# Private claim RPC deadlines

The ordinary Supabase claim and ownership-history ports attach a fixed 15-second
`AbortSignal.timeout` to each existing PostgREST RPC. The installed builder passes
that signal to its HTTP transport. The five RPCs retain their existing POST calls,
validated bindings, hash-only claim arguments and fixed public error vocabulary;
there is no global fetch change, alternate store or retry.

Preparation still precedes providers. After the original is saved, an issuance
timeout resolves private delivery as unavailable so the completed answer can be
returned. Its answer, recorded financial fields and saved bytes remain unchanged.
The one-shot completion cannot mint another credential. A consume timeout is an
uncertain acknowledgement: it does not prove that the server rolled back and must
not trigger an automatic consume retry or reissue.

Owner-history reads also terminate independently of the browser's shorter read
deadline. This does not propagate browser cancellation into the server RPC; it
places the same finite transport deadline on the two fixed server read ports.

Offline regression tests exercise the installed Supabase/PostgREST builder with
an injected, outbound-denied transport. One uses the real 15-second timeout after
an isolated in-memory SQLite save; the other four RPCs verify exact timeout
configuration, signal propagation, fixed refusal and one-call behavior with
controlled cancellation. These are synthetic reliability fixtures, not production
measurements or storage/native activation. No shared schema, claim contract,
financial authority, funding or deployment admission changes.
