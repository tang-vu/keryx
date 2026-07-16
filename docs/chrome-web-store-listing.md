# Chrome Web Store — listing kit for the Keryx extension

Everything to paste into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
Prereq: Google account + one-time $5 developer registration fee.

## Upload

- Build the zip: `npm run pack:extension` → `keryx-extension-v0.1.0.zip` (repo root, gitignored).
- Bump `extension/manifest.json` `version` before every re-upload — the store rejects a reused version.
- Zip has no top-level folder (store requirement); exactly 10 files, no README.

## Store listing tab

| Field | Value |
|---|---|
| Name | Keryx — Ask & pay creators |
| Summary (≤132 chars) | Highlight text on any page, ask Keryx, get a cited answer — and every writer it cites gets paid in USDC. No wallet needed. |
| Category | Productivity → Tools (alt: Search Tools) |
| Language | English |

**Description** (plain text, no markdown):

```
Keryx is a reading agent that pays the writers it reads.

Highlight text on any page, right-click "Ask Keryx", and watch the agent work in real time: it decides which paid sources to buy, reads them, writes a grounded answer with citations — and settles a real USDC micropayment to every creator it cited, on Circle's Arc network. 100% of citation rewards go to creators. No wallet, key, or sign-up needed: the free tier is built in.

WHAT IT DOES
• Toolbar popup — type or paste a question (pre-filled with your selection), set a budget, watch the agent's live buy/skip/trust reasoning stream in before the answer and the list of creators it paid.
• Right-click on selected text — "Ask Keryx about …" opens the same panel pre-filled.
• Right-click on a page you own — "List this page as a paid source" opens keryx.cc/register with the URL and title filled in, so your page can start earning per citation.

PRIVACY
The only network destination is keryx.cc, and only when you press Ask. No analytics, no tracking, no background reading of pages. Full policy: https://keryx.cc/privacy

Keryx runs on Circle's Arc testnet — payments are real on-chain settlements in testnet USDC. Answer permalinks are public.
```

## Privacy tab

- **Single purpose:** Ask the Keryx reading agent a question about text the user highlights (or types) and show the cited, creator-paid answer; optionally deep-link a page the user owns to the Keryx source-registration form.
- **Privacy policy URL:** `https://keryx.cc/privacy`
- **Remote code:** No. All code is in the package; the extension only makes HTTPS API calls.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `contextMenus` | Adds the two right-click entry points: "Ask Keryx about <selection>" and "List this page as a paid source". |
| `activeTab` | Reads the current tab's URL/title only when the user invokes the extension, to pre-fill the question context or the source-registration form. |
| `scripting` | One-shot `executeScript` on user invocation to read `window.getSelection()` so the popup pre-fills the highlighted text. Never runs in the background. |
| `storage` | `chrome.storage.local` hands the right-click selection to the popup window. Device-local only. |
| Host `https://keryx.cc/*` | The single API endpoint the question is sent to and the answer streams from. |

**Data-usage disclosure (checkboxes):**

- Collects: **Website content** — the text the user highlights and, only on the explicit "list this page" action, the page URL/title. Sent to keryx.cc to answer the question / pre-fill the form. Note: answered questions are published at a public permalink (disclosed in listing + policy).
- Does NOT collect: PII, health, financial, auth info, personal communications, location, web history, user activity.
- Certify: data not sold; not used/transferred for purposes unrelated to the single purpose; not used for creditworthiness.

## Assets

| Asset | Status |
|---|---|
| Store icon 128×128 | ✅ `extension/icons/icon-128.png` |
| Screenshots 1280×800 (1–5) | ⬜ capture: popup mid-stream (reasoning trace), answer + creators-paid list, right-click menu on a selection, /register pre-filled |
| Small promo tile 440×280 | ⬜ optional — herald seal on parchment + one-line tagline |

## Submit

1. Dashboard → New item → upload the zip.
2. Fill the two tabs above, add screenshots, save draft.
3. Submit for review — first review typically 1–3 days (MV3, low-risk permissions).
4. After approval, add the store URL to `extension/README.md`, keryx.cc footer, and post a Canteen update.

## Unresolved questions

- Screenshots need a manual capture pass (1280×800) — headless capture of the popup is possible via the demo-clip workflow but store shots read better with the real toolbar context.
- Publisher display name/email on the dashboard (defaults to the Google account) — decide before first submit.
