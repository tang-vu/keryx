# Keryx browser extension

Highlight text on **any** page → ask Keryx → get a cited answer while every source it reads gets
paid in USDC on Arc. Or right-click a page you own → list it as a paid source in one hop.

It is a thin client over the public [OpenAI-compatible endpoint](https://keryx.cc/api/v1) — no
wallet, no key, no build step. The anonymous free tier is treasury-funded and IP rate-limited, the
same guard the site's own no-wallet asker uses.

## What it does

- **Toolbar popup** — click the herald, type or paste a question (auto-filled with your current
  text selection), set a budget, and watch the agent's live buy / skip / trust reasoning stream in
  before the grounded answer and the list of creators it paid.
- **Right-click → "Ask Keryx about …"** — on any selected text; opens the same panel pre-filled.
- **Right-click → "List this page as a paid source on Keryx"** — deep-links to `/register` with the
  page URL + title filled in, so a page you control can start earning per citation.

## Install (unpacked, for now)

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and select this `extension/` folder.
3. Pin the Keryx herald to your toolbar. Highlight text on any page and ask.

Works on any Chromium browser (Chrome, Edge, Brave, Arc). Manifest V3.

## Configuration

`keryx-config.js` points at `https://keryx.cc`. To test against a local dev server, change
`KERYX_ORIGIN` there and add the origin to `host_permissions` in `manifest.json`.

## Files

| file | role |
| --- | --- |
| `manifest.json` | MV3 manifest — action popup, context menus, host permission for keryx.cc |
| `background.js` | service worker — registers the two right-click menus, routes their clicks |
| `popup.html` / `popup.css` / `popup.js` | the ask panel — resolves the question, streams the answer, shows creators paid |
| `keryx-config.js` | shared origin + endpoint constants |
| `icons/` | herald-seal icons (generated from `app/icon.svg`) |

## Privacy

The only network call is to `https://keryx.cc/api/v1/chat/completions` with the question you ask.
No analytics, no tracking, no other hosts. The page URL/title are only used — and only sent to
keryx.cc — when you explicitly pick "List this page as a paid source".
