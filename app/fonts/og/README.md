# Public preview fonts

These unmodified static fonts are loaded from disk by `lib/og-fonts.ts` for public
dispatch, creator, wanted and researcher-profile Open Graph images. No font service is required for
Vietnamese, Simplified Chinese, Japanese, Korean, Hindi or Arabic-script text. This provides glyph coverage without
selecting an answer language or activating a translated interface.

- `noto-sans-regular.ttf`: Noto Sans, 569208 bytes, SHA-256
  `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5`.
  [Immutable upstream source](https://github.com/notofonts/noto-fonts/blob/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSans/NotoSans-Regular.ttf).
- `noto-sans-sc-regular.otf`: Noto Sans SC language-specific subset, 8331336 bytes,
  SHA-256 `faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9`.
  [Immutable upstream source](https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf).
- `noto-sans-math-regular.ttf`: Noto Sans Math, 590904 bytes, SHA-256
  `80b61fd613d3519197e64fff6f7e71fdc7f3e6526440ea4115b554ef7fd59af7`.
  [Immutable upstream source](https://github.com/notofonts/noto-fonts/blob/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSansMath/NotoSansMath-Regular.ttf).
  Uses the accompanying Noto Sans license notice.
- `noto-sans-jp-regular.otf`: Noto Sans JP language-specific subset, 4533028 bytes,
  SHA-256 `dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073`.
  [Immutable upstream source](https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf).
- `noto-sans-kr-regular.otf`: Noto Sans KR language-specific subset, 4644748 bytes,
  SHA-256 `69975a0ac8472717870aefeab0a4d52739308d90856b9955313b2ad5e0148d68`.
  [Immutable upstream source](https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf).
  Both faces use the existing `OFL-noto-sans-sc.txt` notice. Its text matches the
  [pinned CJK license](https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/LICENSE),
  allowing one retained copy of that notice.
- `noto-sans-devanagari-regular.ttf`: Noto Sans Devanagari, 219212 bytes,
  SHA-256 `385e78e6359a9d88a0f243d53b1209d7548361ba2194e2b9ec779bcaa7e8949d`.
  [Immutable upstream source](https://github.com/notofonts/noto-fonts/blob/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf).
  Uses the existing `OFL-noto-sans.txt` notice; its text matches the
  [pinned Noto license](https://github.com/notofonts/noto-fonts/blob/ffebf8c1ee449e544955a7e813c54f9b73848eac/LICENSE).
- `noto-sans-arabic-regular.ttf`: Noto Sans Arabic 2.013, unmodified hinted regular
  TTF, 234892 bytes, SHA-256
  `bdff3e5659d67e67def05b33f749683b9376ae819d65d3dd62ac4640b3aaef48`.
  [Upstream release](https://github.com/notofonts/arabic/releases/tag/NotoSansArabic-v2.013),
  commit `1b2b7e5c6ce3ab4d50681c854892325530084c35`, asset member
  `NotoSansArabic/hinted/ttf/NotoSansArabic-Regular.ttf`. The release ZIP's verified
  GitHub asset SHA-256 is
  `1301aceaea84c501cf2e6dcfb3182e2328c8eae5725817fcb239672bda7154f1`.
  Keep its accompanying unmodified `OFL-noto-sans-arabic.txt`, SHA-256
  `a7a5a25eb188bf1cd96982030d53e23c33485c69b1044a562254226857ee13af`.

The original three faces were retrieved October 11, 2026; Japanese, Korean and
Devanagari were retrieved October 29, 2026; Arabic was retrieved October 30, 2026.
Keep the accompanying SIL Open Font License notices with the fonts. Additional
faces load lazily for their scripts:
Han, Japanese kana, Hangul, Devanagari, Arabic and mathematical symbols (including the
existing wanted-card `≤` caption). Cached font data is process-local. These are
server image assets, not browser fonts or package dependencies. Glyph selection
does not establish answer-language provenance. Captions use the existing bounded
recorded-language presentation; financial and historical-network wording stays English.

Glyph coverage is not sufficient for Devanagari conjuncts and vowel positioning,
or Arabic joins and marks.
`lib/og-text.ts` uses the already locked Sharp 0.35.5 Pango/HarfBuzz text renderer
and these local faces to create bounded PNG text nodes for these strings before
Satori lays out the card. A process-local initialization registers the seven fixed
font files with libvips, including mixed-script fallback; no host fonts or remote
font service are needed for the listed scripts. Original text is escaped as literal
Pango text, with automatic hyphen insertion disabled. Dispatch, creator and wanted
keep their existing text nodes outside Devanagari and Arabic-script fields.

Researcher profiles also fit complete names and introductions in bounded regions
for every script. Long fields rewrap at a smaller size instead of overlapping the
ownership caption. Publication is rechecked after both font loading and shaping.
The actual compiled-profile fixture uses an empty fontconfig, checks the build's
font/native-library trace and retains thirteen native, mixed and long-field PNGs.
Arabic-script originals remain independent of supported generated-answer languages.
