# Saved receipt download recovery

Saved jobs already verify completed job and receipt binding through read-only
GET recovery. The local receipt button previously called the JSON downloader
without handling preparation errors, unlike recovery-file export. An unavailable
Blob URL or failing native DOM operation could therefore escape the click handler
without giving the user a retry message.

Receipt export now has its own selection-bound feedback channel. Starting another
receipt attempt clears that attempt's previous error. Recovery-file export and
local-removal feedback remain separate; succeeding at one operation does not hide
another operation's failure. Closing, reopening or selecting another view cannot
revive an earlier view's receipt error. The retry uses the already verified local
receipt; it does not submit payment, authorize a signature or rewrite a journal.
The alert sits next to the receipt button and is linked through aria-describedby,
so a long answer does not separate the feedback from its triggering action.

The downloader now covers anchor creation, attachment and clicking inside its
cleanup boundary. Every allocated Blob URL is scheduled for revocation, even when
preparation throws before clicking. The existing one-second revocation delay,
application/json MIME, generic filenames and exact text bytes are preserved.
Initiation feedback does not assert that a browser ultimately saved a file.

The browser regressions run the minified real workspace, native IndexedDB,
browser job/receipt verification and native Blob/DOM operations. Controlled
Testnet HTTPS fixtures supply synthetic jobs and self-hashed receipts; they are
not real settlement evidence. All observed recovery requests must remain GET-only
without payment signatures. Downloaded bytes and receipt digest are checked, and
both original serialized journals must stay unchanged after failure and retry.

The generic localized "Download unavailable. Try again." message already used by
export controls is reused for receipt initiation. No protocol, amount, custody,
receipt verification, evidence authority, storage or publication rule changes.
