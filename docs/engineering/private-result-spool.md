# Encrypted private result backups

The private executor accepts an optional `resultSpool`. When supplied, it saves an
encrypted snapshot before writing the result to the database. If the database write
fails, the permanent execution claim remains and the backup can be restored without
running research or payments again. The operator worker command now supplies a spool
from explicit environment configuration, and enabled bootstrap requires it. No
production directory, key or running private worker has been provisioned.

`createPrivateResultSpool(directory, keyHex)` requires an existing parent directory
and a dedicated 32-byte encryption key represented by 64 hex characters. Operators
must supply this key through an environment file; never reuse a wallet signing key.
No key is generated, logged or provisioned by this helper.

Snapshots use AES-256-GCM with a random 12-byte IV, a 16-byte authentication tag and
a random filename token bound as additional authenticated data. The encrypted payload
contains the original owner, worker claim and exact serialized result. Neither the
question nor job identifier appears in plaintext filenames or envelopes. Restore
authenticates before parsing the plaintext and calls `savePrivateResearchResult`,
which revalidates the original intent, owner, worker claim and immutable result.
Deletion requires an exact acknowledgment of the saved serialization.

Writes use exclusive files, file fsync and, on POSIX, directory fsync. New directories
request mode 0700 and files request mode 0600. These modes do not establish Windows
ACLs or repair permissions on existing directories. The directory must be operator
controlled. Root symlinks are rejected; this does not defend against a local actor who
can replace files or directories. Plaintext exists in process memory, and filesystem
metadata reveals file count, size and timing.

A failed database write retains the encrypted file. If deletion or its directory
fsync fails after successful database storage, the restore reports an error: inspect
both storage locations rather than assuming the backup still exists. A disk failure
before a durable snapshot, loss of the encryption key, or loss of the only disk can
still lose a result. This is not an offsite backup, execution authorization or
independently verifiable payment receipt.

Recovery uses `private-worker -- --restore <backup-token>` with the token from the
backup filename. The worker also performs serial automatic recovery in batches of at
most 25 directory entries; it waits for a clean sweep before executing new work.
The iterator advances past failed files and closes on graceful shutdown. It is not
a snapshot or a lock against other processes: run one worker per spool and stop it
before manual recovery. Key backup/rotation, retention limits,
disk monitoring and crash drills remain unfinished. Do not activate checkout based
on this helper alone.

Focused tests cover randomized ciphertext, wrong keys, token substitution, tampering,
failed or mismatched database acknowledgments and deletion after exact storage. The
checkout integration drill additionally exercises a database write outage, permanent
claim exclusion, SQLite reopen and restoration with no repeated execution. All use
synthetic data; no live settlement is exercised.
