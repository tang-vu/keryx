# Public profile metadata consumer — 2026-10-15

Related: #277. This completes the bounded source change for the existing
`/u/[handle]` consumer. Original issue acceptance remains with ROOT after actual
validation and delivery.

The page uses `englishPublicAlternates` for its existing canonical, retaining the
`application/json` alternate at `/api/u/[handle]`. Only the `ProfilePage` JSON-LD
wrapper declares `inLanguage: "en"`; the Person biography and selected originals
receive no English declaration. Owner text and existing URLs remain exact.

The sitemap adds `englishSitemapAlternates` only to the profile rows returned by
the existing uncached public-profile admission. All other entries and admission,
privacy, revocation and unavailable behavior retain their existing paths.

The image selects `publicPreviewFonts` over every displayed string and uses
`publicPreviewFontFamily`. After the font await it performs a fresh actual public
profile read. Withdrawal, refusal or changed displayed text returns an empty
no-store 404, preventing an old candidate from surviving that asynchronous
boundary. A subsequent request can render a changed public profile. There are no
remote fonts or provider fallbacks.

The two existing test files add direct page metadata/schema, sitemap continuity,
refusal, real local font selection and held-font revocation cases. Profile VI/Han
PNG cases reuse the existing local-only ImageResponse/WASM adapter and optional
`KERYX_PREVIEW_CAPTURE_DIR` convention. Fixture controls do not replace actual
database publication/revocation acceptance or compiled head verification.

No tests, type checks, builds, browser/provider/DB calls or publication were run
by this source worker. Parent owns different-author source review, focused
tests/types, actual VI/Han PNG review, one current build, required CI and prompt
serialized merge. Reuse the retained 67 report tests and seven PNGs for their
unchanged scope. English remains the sole shipped UI; locale review remains
`null`. Financial, auth, native, schema, publication and locale flags are unchanged.
Web profile metadata is the affected surface; API JSON, CLI, desktop, MCP,
extensions and bots keep their existing contracts and publication authority.

Before coding, the worker read the installed Next 16.3.8 metadata alternates and
shallow merge guidance, sitemap language alternates, metadata image conventions
and ImageResponse font/response options. Exact input/source pins, raw before/after,
inverse patch and parent commands are retained locally in
`output/profile277-source-completion/`; generated images and snapshots do not
belong in this tracked document.
