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
`font-display: swap`, and requested normal and italic weights. Only Latin subsets
are bundled, as before; other scripts use the existing CSS fallbacks.
