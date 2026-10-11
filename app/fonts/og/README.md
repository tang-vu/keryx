# Public preview fonts

These unmodified static fonts are loaded from disk by `lib/og-fonts.ts` for public
dispatch, creator and wanted Open Graph images. No font service is required for
Vietnamese or Simplified Chinese text. This provides glyph coverage without
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

Retrieved October 11, 2026. Keep both accompanying SIL Open Font License notices
with the fonts. The Chinese face is read lazily only for text containing Han
characters, and the math face only for mathematical symbols (including the
existing wanted-card `≤` caption); cached font data is process-local. This is a server image asset,
not a browser font or a package dependency. Other scripts are not certified by
this change. Preview captions retain the shipped English interface wording.
