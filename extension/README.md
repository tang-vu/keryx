# Keryx browser extension

Highlight text on **any** page → ask Keryx → get a cited answer with citation
allocations and recorded creator-payment state in USDC on Arc. Or right-click a
page you own → open its source-registration form.

It is a thin client over the public [OpenAI-compatible endpoint](https://keryx.cc/api/v1) — no
wallet, no key, no build step. The anonymous free tier is treasury-funded and IP rate-limited, the
same guard the site's own no-wallet asker uses.

Public production uses Arc mainnet. The extension has no wallet signer or local
network selector; it consumes the selected hosted deployment. Planned rewards
and pending payments remain separate from settled creator payouts. See
[current deployment and distribution evidence](../docs/mainnet-status.md).

## What it does

- **Toolbar popup** — type a question or use your selection, choose Quick/Deep and a source
  budget from $0 to $0.08, and inspect the live research trace and cited answer. Server admission
  and sponsored limits remain authoritative; model/search costs are separate from source spending.
- **Optional context** — deliberately include the displayed page URL as a source, or opt into
  public scholarly discovery. Full page content is never collected automatically.
- **Recorded results** — inspect original-source links, planned rewards, recorded totals and
  pending source spend; open the full report/receipt or download its recorded BibTeX, RIS,
  CSL-JSON and evidence CSV without another research request.
- **Recovery and handoff** — Stop watching disconnects this popup; it does not promise to cancel
  server work or payments. Errors and incomplete streams remain failures, with no automatic retry.
  Opening an editable web question never auto-submits it. Sources, Literature and My research
  link to their existing hosted workspaces.
- **Recent reports** — keep at most ten completed report URLs and timestamps on this device.
  The device list stores no question, answer, page content, token or wallet key and can be cleared.
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
| `recorded-usdc.mjs` | exact recorded-money display; byte-identical to `lib/display/recorded-usdc.mjs` and checked before packing |
| `research-client.mjs` | bounded request, safe URL/handoff and streamed completion rules |
| `icons/` | herald-seal icons (generated from `app/icon.svg`) |

## Privacy

The popup reads public availability from `https://keryx.cc/api/research/availability` and sends
your submitted question to `https://keryx.cc/api/v1/chat/completions`. Including the page URL is
unchecked by default; when selected it becomes a visible source URL in that question. Scholarly
opt-in allows the hosted service to send the question to public scholarly discovery providers.
Page URL/title are also sent when you explicitly list a page as a source. No analytics or tracking
are added. Opening the web question or workspace sends its URL to the hosted service only through
your deliberate navigation. [Supported roles and future update checklist](../docs/browser-extension.md).
