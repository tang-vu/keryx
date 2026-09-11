# Withdrawal backup and recovered-copy drill

This checks the operator CLI and recovered journal contents on Linux. It does not
activate a restored signer, establish an off-site backup service or close M4/M5.

`scripts/test-withdrawal-backup-restore.mts` creates unfunded synthetic identities,
one saved signed mint and a second gas admission without an assigned nonce. With
the SQLite WAL source still open, it runs the real backup CLI in a child process
and retains the returned manifest digest in a separate private fixture file.

The test closes the source and moves its original directory aside. It copies the
backup into a new private directory and runs the real inspection CLI in another
process, supplying the separately retained digest. It then opens that copy and
checks the exact signed transaction bytes and both gas obligations. Finally it
alters the recovered manifest and verifies a nonzero inspection exit with no
successful result or signed payload in the error output.

The standalone Linux run used Node 24.14.1 in a container with networking disabled
and the repository mounted read-only. All journal files were in a private temporary
directory. No live wallet, Circle request, on-chain transaction or service activation
was involved. The CI workflow now runs the same script on Linux/Node 24.
The measured fixture sequence took 37.740 seconds, including child-process startup
and the negative check. This is a local test duration, not a production recovery SLO.

Still required: a durable off-host encrypted copy, independently retained production
digest, application-journal pairing, all later-signature accounting, actual host/key
recovery, incident ownership and a funded restore/reconciliation drill. Passing
`verified-backup-copy` only establishes that the tested copy matches the retained
record. It does not establish that the record is current or safe to resume signing.
