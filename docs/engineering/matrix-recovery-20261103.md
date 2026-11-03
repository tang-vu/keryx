# Keep matrix notes across same-tab navigation

The literature matrix keeps an exact recovery copy in session storage by default.
After a reload or a return to the worksheet in the same tab, it restores the
question and every row without CSV conversion, clipping, deduplication or source
inference. Recovery never marks notes as a downloaded editable backup. Closing
the tab ends the ordinary recovery lifetime; the editable JSON download remains
the lasting and portable copy. Browser session restoration can retain tab data.

The visible recovery checkbox turns this behavior off and replaces the stored
notes with a fixed disabled marker. The choice lasts for the tab. No matrix
content is uploaded, placed in a URL, stored in account data or shared by a server.
Browser storage is not encrypted or an account-private vault. Users on a shared
browser should disable recovery and keep their own editable file.

Recovery accepts only the strict versioned editable-matrix JSON contract, with
the existing 50-row, 2,000-character field and 6 MiB file bounds. CSV, library
backups, unknown keys and foreign versions refuse. An unreadable record remains
untouched until the user explicitly replaces recovery with the current matrix.
Read/write or quota refusal keeps the visible notes and the last stored copy,
reports that the newest changes may not be recoverable and never claims a
successful opt-out when removing the old content failed.

A capture-phase listener asks before ordinary same-origin, same-tab link
navigation while an editable backup is missing. Cancel prevents client-side
navigation before the worksheet can unmount. Modified/new-tab/download and
same-document anchor actions retain their normal behavior. Browser Back is
recovered through tab storage; no router or History API is patched. If recovery
is disabled or refused, users must download their notes before leaving. Existing
document-unload warnings remain, and page hiding attempts a final recovery save.

Focused Chromium coverage exercises exact multilingual/formula-like recovery,
reload, cancelled/accepted client navigation and Back, disabled recovery,
malformed records, denied storage and quota failures. The existing built-page
file-acceptance journey additionally proves that reload restores the current
notes before independently exercising the unchanged file-import workflow.
Metadata, payment and research APIs receive no new requests. New authored copy
uses the existing locale fallback until translated preview strings are supplied.

This is source work only. Required PR CI and review remain acceptance gates;
deployment, package publication, release and version allocation are held by the
owner's November 3 direction.
