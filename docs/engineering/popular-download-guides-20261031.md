# Popular-language download guidance

The ten newer interface previews could explain which Keryx client to choose, but
their download page still used English for installation requirements and steps.
Add 20 neutral download entries each for Spanish, Brazilian Portuguese, French,
German, Japanese, Korean, Hindi, Indonesian, Russian and Arabic. This brings each
partial get-started draft from 56 to 76 entries and each partial interface draft
from 407 to 427 entries. All remain machine drafts without human approval.

The additions cover Windows requirements, installer and portable ZIP choices,
release manifests/checksums, the first two Windows install steps, browser extension
requirements, the first three extension install steps and using Keryx without a
download. Technical filenames, browser setup URLs and English browser control names
remain exact. French and German retain the identical Windows x64 / Alpha tag.
German guidance follows the existing informal du voice.

The English source, metadata, release versions, destinations and client contracts
remain unchanged. Existing payment, privacy, receipt and recovery guidance stays
under the current critical-copy filter and approval policy. The English default and
lazy selected-locale chunks remain in place; this change does not add locale routes
or change Server/Client Component boundaries. Setup steps pass a finite list of
exact authored filenames, browser setup URLs and browser control names to the
existing client text leaf. Translated text isolates these tokens in nonbreaking
LTR runs, preserving their exact bytes and surrounding translation. Tokens absent
from the English source are ignored; English fallback and plain rendering retain
their existing output. Original report and user data never use this opt-in path.

Focused acceptance covers source bindings, immutable install literals, real download
page actions, language/direction for individual steps and critical English fallback
across all 12 non-English prepared locales. Responsive compiled browser acceptance,
full required PR/domain/platform CI, retained original visual review, exact-main CI
and the existing guarded merge/cleanup workflow remain required. ROOT/Circle owns
the separate runtime/publication batch; source acceptance is not runtime delivery.
