# Popular-language setup choices

The ten newer interface previews translated the entry headline but left the
seven setup cards in English. Users could choose a language and still struggle
to understand whether to use the web app, Windows desktop, browser extension,
MCP, API, command line or chat bots.

Each preview now has 37 additional source-bound get-started entries: surface
names, neutral purpose descriptions, actions, platform guidance and common
setup labels. Spanish, Brazilian Portuguese, French, German, Japanese, Korean,
Hindi, Indonesian, Russian and Arabic retain `machineDraft` with `review: null`.
Brand labels may remain identical to English. This brings their get-started
inventory from 19 to 56 entries each; it does not establish full product
translation or human approval. Existing Vietnamese and Simplified Chinese
drafts retain their authored text.

Setup leaves explicitly select the get-started namespace, so a label shared
with an unrelated catalogue cannot make the intended translation ambiguous.
Pages and their children remain server rendered with the existing client text
leaves. Canonical English metadata, links, client roles, installation guidance,
questions, payment authority and actual release identities are unchanged.
Financial, privacy, custody and recovery explanations retain their English
fallbacks and existing review gates. The MCP funding-role and CLI custody
details are not added to these partial drafts.

The generator retains a floor of 56 authored and admitted setup keys in each
partial preview. Tests inspect the real setup page, its seven destinations,
language tags, Arabic direction and namespace collisions. Compiled browser
acceptance covers the existing prepared-language matrix, native setup card
copy, platform FAQ, keyboard disclosure, reload and zero research/signing
requests at responsive sizes. Full source/domain/platform CI, visual review
and exact main acceptance remain separate mandatory gates. ROOT/Circle owns
the eventual runtime batch.
