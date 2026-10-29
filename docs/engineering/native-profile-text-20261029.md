# Complete native text in public-profile previews

Actual `/u/[handle]/opengraph-image` PNGs exposed two presentation failures:
Satori separated Hindi conjuncts/vowels, and long Japanese fields overlapped the
introduction and ownership caption even within the existing profile limits.

The profile route now prepares the complete name and selected introduction with
`publicPreviewFittedText`. Each has a fixed maximum width and height; Pango
rewraps oversized text at a smaller size. Images do not shrink during card layout.
Original Unicode normalization, literal markup-like text and complete alternative
text are preserved. Invalid display controls retain the existing display-only
replacement. Automatic hyphen insertion is disabled.

The existing six licensed font files are registered once with libvips for mixed
Latin, Han, kana, Hangul, Devanagari and mathematical glyphs. There is no new font
download, dependency version or system fontconfig mutation. Unlisted scripts are
not newly claimed as visually qualified. Dispatch, creator and wanted previews
keep their original text nodes outside Devanagari; their existing native shaping
also receives the bundled mixed-script fallback.

## Public visibility and failure paths

Font loading and shaping start only after `loadPublicProfile` admits the public
projection. After **all** awaited preparation, the route reloads that projection
and compares every displayed string. Withdrawal, changed displayed fields and a
refused final read return an empty, uncached 404. Local font/shaping failures
propagate without a provider or network fallback. No private fields are selected
for the image. The existing consent, privacy, owner authorization and financial
storage paths keep their established authority.

## Acceptance and supported surfaces

- Focused unit coverage exercises held font and shaping I/O, withdrawal, changed
  fields, read failures, local rendering failures, literal markup and bounded
  complete native fields. Actual ImageResponse tests retain eleven PNG cases.
- The existing stock Next production fixture checks the profile route's real
  `.nft.json` for all six fonts, Sharp's entry point/binding and libvips. It runs
  the owned Next child with an empty fontconfig, explicitly republishes eleven
  synthetic profiles through the authorized owner route, checks exact selected
  originals and retains `profile-og-*.png` plus hashes in `acceptance.json`.
- Inspect those compiled PNGs for Hindi shaping, mixed-script glyphs, full long
  text, margins and separation from the ownership caption. PNG validity alone
  does not establish correct typography. Existing real Chromium profile checks
  at 320/390/768/1366px, private exclusion and revocation remain required.
- Run the existing full PR `build-and-test` and applicable domain/platform gates.
  No docs-only CI waiver applies. Source acceptance, human translation review
  and deployment are separate claims.

The public web share-image consumer changes. Profile HTML/JSON and the desktop
web view keep original fields and existing English ownership/financial labels.
CLI, remote/stdio MCP, extension and bot contracts continue linking to the same
public profile; this presentation change adds no adapter or payment capability.
ROOT/Circle retains the coordinated release and prepared-cutover gates. A source
merge does not establish production delivery.

Renderer behavior was checked against the pinned Sharp 0.35.5/libvips 8.18.7
runtime and primary [libvips text implementation](https://github.com/libvips/libvips/blob/v8.18.7/libvips/create/text.c),
[Sharp text input reference](https://sharp.pixelplumbing.com/api-constructor/)
and [Pango literal/line-breaking attributes](https://docs.gtk.org/Pango/pango_markup).
