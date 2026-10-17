# Web fonts

The web layout uses these checked-in Latin WOFF2 files through `next/font/local` so
production builds do not depend on a Google Fonts response or build cache. Keep the
files and their SIL Open Font License notices together when updating them.

- Bodoni Moda normal, Spectral normal (300, 400, 500, 600), and Spline Sans Mono
  normal were copied from the existing `desktop/assets/fonts/` assets.
- Bodoni Moda italic (variable weights 400-800) and Spectral italic (300, 400,
  500, 600) were downloaded on 2026-09-29 from the Latin WOFF2 URLs returned by
  the [Google Fonts CSS API](https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@1,400..800&display=swap)
  and [Spectral CSS API](https://fonts.googleapis.com/css2?family=Spectral:ital,wght@1,300;1,400;1,500;1,600&display=swap),
  respectively. Their font metadata was checked for italic style and weight.

Exact italic downloads and SHA-256 hashes:

- `bodoni-moda-latin-italic.woff2`: [source](https://fonts.gstatic.com/s/bodonimoda/v28/aFTB7PxzY382XsXX63LUYJSPUqb0pL6OQqxrZLnVbtxSXgM.woff2), `e50a00b8431381bd33c7676c50ffb98fc95f4a06c707ea44d04a423266e211cd`
- `spectral-latin-italic-300.woff2`: [source](https://fonts.gstatic.com/s/spectral/v15/rnCu-xNNww_2s0amA9M8qtHEWfSFXQ.woff2), `b1dc3c4e4bebc0768c8bc9b4662ea2ad7f9fb2b19f98b3b023cf2fbb6e8e362e`
- `spectral-latin-italic-400.woff2`: [source](https://fonts.gstatic.com/s/spectral/v15/rnCt-xNNww_2s0amA9M8onrmTA.woff2), `db397149a9f73fd6a41dd2fdf3314cf8a9daf0485134465cc268cac578766b71`
- `spectral-latin-italic-500.woff2`: [source](https://fonts.gstatic.com/s/spectral/v15/rnCu-xNNww_2s0amA9M8qonFWfSFXQ.woff2), `54be969918765d12c05e1eb4bc69a4503644728beb556c6a9bac1fcfbe60bb3d`
- `spectral-latin-italic-600.woff2`: [source](https://fonts.gstatic.com/s/spectral/v15/rnCu-xNNww_2s0amA9M8qqXCWfSFXQ.woff2), `2a3ef8cf75b8b425b24d2c187d5da023d1a8f8128651885a46bf95405cb63fdc`

The registered faces preserve the layout's existing families, CSS variables,
`font-display: swap`, and requested normal and italic weights. These default faces
keep their original Latin subsets; the Vietnamese preview uses the local faces below.

## Vietnamese preview typography

The Vietnamese UI preview selects local Latin + Vietnamese subsets only while
`html` has `lang="vi"`. English and Chinese retain the original font stacks and
do not request these additional assets. The locale provider still owns language
selection; this change does not affect translation approval or language persistence.

Spectral retains its existing reading style, with normal/italic weights 300?600.
Bodoni Moda and Spline Sans Mono do not provide the full Vietnamese alphabet, so
Vietnamese uses Playfair Display (400?800, normal/italic) for display headings and
Roboto Mono (400?600) for labels. Their OFL notices are included here.

These WOFF2 files were produced on 2026-10-17 with fontTools 4.67.0 and Brotli
1.2.0 from the official Google Fonts sources below. Subsets retain the original
Latin coverage, the 102 Vietnamese precomposed letters, available combining marks,
the dong symbol and OpenType layout features. Internal family names are changed
to Keryx Vietnamese Text/Display/Mono; copyright and license records are retained.
They load on demand through CSS, without build-time or runtime font-service calls.

- `spectral-vietnamese-italic-300.woff2`: [source](https://fonts.gstatic.com/s/spectral/v15/rnCu-xNNww_2s0amA9M8qtHEafM.ttf), Version 2.005; ttfautohint (v1.8.4.7-5d5b), SHA-256 `1e30c849da4c97f821718c26bbf298b2d3f1a1bff9910ac4ef2e1b9bffa97dee`
- `spectral-vietnamese-italic-400.woff2`: [source](https://fonts.gstatic.com/s/spectral/v15/rnCt-xNNww_2s0amA9M8kn0.ttf), Version 2.005; ttfautohint (v1.8.4.7-5d5b), SHA-256 `ef72dd95c1133b366fe6b8093577a71826d627d60b934d8318e8d6904b6ca225`
- `spectral-vietnamese-italic-500.woff2`: [source](https://fonts.gstatic.com/s/spectral/v15/rnCu-xNNww_2s0amA9M8qonFafM.ttf), Version 2.005; ttfautohint (v1.8.4.7-5d5b), SHA-256 `4a79a764e66f0d6478cf46e191935c3c1f8c849347714c9e532248e15d18fbfa`
- `spectral-vietnamese-italic-600.woff2`: [source](https://fonts.gstatic.com/s/spectral/v15/rnCu-xNNww_2s0amA9M8qqXCafM.ttf), Version 2.005; ttfautohint (v1.8.4.7-5d5b), SHA-256 `d618688655e240b5d315d944342ec1287771a80513c5d98780e44a88b930b45d`
- `spectral-vietnamese-300.woff2`: [source](https://fonts.gstatic.com/s/spectral/v15/rnCs-xNNww_2s0amA9uSsF3G.ttf), Version 2.005; ttfautohint (v1.8.4.7-5d5b), SHA-256 `139c89f836f20c024faad5bb6f7a50af46e0c92636930fdea5ba2e6cb6dcda3b`
- `spectral-vietnamese-400.woff2`: [source](https://fonts.gstatic.com/s/spectral/v15/rnCr-xNNww_2s0amA-M-.ttf), Version 2.005; ttfautohint (v1.8.4.7-5d5b), SHA-256 `161ce615ed66b256b896cba391f36fce6d677d66de108e273629d90e184f34ca`
- `spectral-vietnamese-500.woff2`: [source](https://fonts.gstatic.com/s/spectral/v15/rnCs-xNNww_2s0amA9vKsV3G.ttf), Version 2.005; ttfautohint (v1.8.4.7-5d5b), SHA-256 `6ea3239ba6bc6754be260bce8f59f3a169c77763cbc27c8ab8983c01c56e64d0`
- `spectral-vietnamese-600.woff2`: [source](https://fonts.gstatic.com/s/spectral/v15/rnCs-xNNww_2s0amA9vmtl3G.ttf), Version 2.005; ttfautohint (v1.8.4.7-5d5b), SHA-256 `ed4e57b49d8c3344e28cd344e33e62b46a0d8e821f129fe4d9fe9634b92e054e`
- `playfair-display-vietnamese.woff2`: [source](https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf), Version 1.203, SHA-256 `f31673da0f2712191d31e79b940f4b6e57a31dc587c6e1f58915cdeee635afa4`
- `playfair-display-vietnamese-italic.woff2`: [source](https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf), Version 1.203, SHA-256 `5763f9a605a9615fd7c82cdf0b11aa42f413764ac8c05a9e29d5291d0503efa2`
- `roboto-mono-vietnamese.woff2`: [source](https://raw.githubusercontent.com/google/fonts/main/ofl/robotomono/RobotoMono%5Bwght%5D.ttf), Version 3.001, SHA-256 `d6635cc6acc14de6bfaa55b4cfdc67b1e57c0c43a36051110df76dc35254b736`
