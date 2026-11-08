# Public checkout recovery downloads

The public wallet checkout writes its unsigned original journal and prepares a
private recovery file before asking the wallet to sign. Native Blob URL or anchor
preparation can fail. Previously the automatic export only produced a general
purchase-stopped status, while manually retrying the file could throw out of the
click handler without actionable download feedback.

Both entry points now show an independent localized alert beside the recovery
button, linked through aria-describedby. A retry clears its own error while
leaving the purchase acknowledgement, uncertainty or pending-wallet status intact.
It downloads the retained original text, without a fresh quote, nonce, signature,
funding operation, journal mutation or paid request. Preparing a newly reviewed
purchase resets the old file feedback; merely reviewing a price does not do so.

The shared local helper still throws after scheduling Blob cleanup. The automatic
onPrepared caller continues to propagate that exception and stops before signing.
Only the manual click contains the exception after retaining feedback. The new
feedback therefore cannot turn a failed automatic export into permission to pay.
Existing generic filenames, exact original JSON bytes and delayed URL revocation
remain. Successful initiation does not claim that the browser ultimately saved
the file.

Native Chromium regressions compose the real request, wallet checkout, funding,
workspace, saved jobs, journal and purchase client. An unfunded synthetic wallet
and intercepted Testnet HTTPS supply controlled quote and acknowledgement facts;
they are not real settlement evidence. Cases include URL/anchor failures before
signing, local retries after an uncertain signed submission, a pending wallet
prompt, fresh consent/originals and an actual request change. Stored journals,
request/signature counts, original download bytes and resource cleanup are checked.

No pricing, refund, protocol, signing, custody, funding, reservation, nonce,
settlement, storage, deployment or publication authority changes.
