# Desktop brand assets

`icon.png` (512 px) and `icon.ico` (16, 24, 32, 48, 64, 128, and 256 px)
are generated from the canonical [`app/icon.svg`](../../app/icon.svg) with
`node desktop/scripts/generate-brand-icon.mjs`. The generator uses the root
project's pinned `sharp` dependency. The Windows ICO uses bitmap and alpha-mask
entries through 128 px for Windows icon APIs, plus a PNG 256 px entry.

The WOFF2 files are the Google Fonts **Latin** web subsets downloaded from
the following pinned asset URLs. These fonts are bundled for offline use;
the application does not request Google Fonts at runtime. Each font's
SIL Open Font License 1.1 text is included alongside it.

| Local file | Source URL | SHA-256 |
| --- | --- | --- |
| `fonts/bodoni-moda-latin.woff2` | https://fonts.gstatic.com/s/bodonimoda/v28/aFTQ7PxzY382XsXX63LUYJSKSKg.woff2 | `c032219ef636f7b4932f7d1dc91bdab602c970f090770b546bea4effaab3463c` |
| `fonts/spectral-latin-300.woff2` | https://fonts.gstatic.com/s/spectral/v15/rnCs-xNNww_2s0amA9uSsG3BafY.woff2 | `3ff652c63672dac64699f04465d7e679045d8cdddfb2a2a1a8762d28866e2891` |
| `fonts/spectral-latin-400.woff2` | https://fonts.gstatic.com/s/spectral/v15/rnCr-xNNww_2s0amA9M5kng.woff2 | `cf8daee3b83c1e662196c6e34e444bc41344d54bfeb4fb5351e197de6ce94539` |
| `fonts/spectral-latin-500.woff2` | https://fonts.gstatic.com/s/spectral/v15/rnCs-xNNww_2s0amA9vKsW3BafY.woff2 | `2b70215ed40f2c73bbc7bb53cff9c8975a244c8462569e60989c77b8c5a87a00` |
| `fonts/spectral-latin-600.woff2` | https://fonts.gstatic.com/s/spectral/v15/rnCs-xNNww_2s0amA9vmtm3BafY.woff2 | `33faca8b5795a0de1af77cbc43a050a3655c4b1e03e04847fdef4d19d2e361d2` |
| `fonts/spline-sans-mono-latin.woff2` | https://fonts.gstatic.com/s/splinesansmono/v13/R70BjzAei_CDNLfgZxrW6wrZOF2WX5KZmA.woff2 | `46b7dcafe3e51dbe87be1bafaac3fed7646db1fe0a146647a6ffce3699f2752d` |

License provenance: [Bodoni Moda](https://github.com/google/fonts/blob/main/ofl/bodonimoda/OFL.txt),
[Spectral](https://github.com/google/fonts/blob/main/ofl/spectral/OFL.txt), and
[Spline Sans Mono](https://github.com/google/fonts/blob/main/ofl/splinesansmono/OFL.txt).

Tauri embeds `dist/ui` in its executable and also copies it as a small resource
mirror. The mirror lets the portable and installed Windows packages use the same
source/hash checks for local fonts and icon plus CSS local-resource checks.
The WebView loads the embedded frontend.
