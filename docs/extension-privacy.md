# Keryx browser extension privacy policy

Last updated: October 11, 2026. Covers the Keryx Manifest V3 extension, including
version 0.1.4.1. The extension is a client for public research at keryx.cc.

## Information you choose to submit

When you invoke the toolbar popup or a context-menu action, the extension can read
the current tab URL, title and selected text. Selected text pre-fills an editable
question. It does not collect full-page text or browsing history in the background.
The page URL is included in a research question only if you check **Include this
page URL as a source**. Review the displayed URL and edited question before sending.

Pressing **Ask Keryx** sends the question, source budget, research depth and
scholarly-search choice over HTTPS to the Keryx API. This extension research flow
is public: questions, answers, reasoning traces, citations and associated payment
records are stored and published at report links, and canonical questions can
appear in the public archive. Do not submit confidential information or personal
information you do not want published. The popup displays this notice before Ask.

Keryx uses a configured AI provider to plan research and generate answers. Search
and scholarly discovery services can process search queries derived from the
question. Source websites receive requests needed to retrieve research material.
This processing supports the research you request. The extension itself makes API
requests only to keryx.cc; Keryx performs the downstream processing. The configured
reasoning provider and optional Cloudflare Workers AI fallback operate under their
API terms. See the [hosted service policy](https://keryx.cc/privacy) for the broader
website, wallet and provider disclosures, and
[Cloudflare's Workers AI data usage policy](https://developers.cloudflare.com/workers-ai/platform/data-usage/).
This extension-specific policy governs the extension behavior described here.

**Open editable question on web** opens a Keryx URL containing the edited question
and options. **List this page as a paid source** opens a creator registration URL
containing the page URL and title. Those URLs can be retained in browser history
and processed by the website. Links to reports, cited sources, workspaces and this
policy navigate to their respective websites when you choose to open them.

## Operational requests and payments

Opening the popup checks Keryx research availability before you submit anything.
Keryx and its hosting provider receive ordinary HTTP request metadata, including
IP address, for these checks and research requests; hosting services can maintain
operational logs. The free tier uses a one-way IP-derived rate-limit bucket that
is not joined to questions; expired limiter buckets are deleted automatically.
The extension has no advertising telemetry or analytics beacon.

The extension displays recorded public payment evidence and does not hold wallet
keys, sign transactions, connect a wallet or create a spending authorization.
Wallet actions on the linked website follow its separate disclosures. On-chain
payment records are public and cannot be erased by Keryx.

## Optional account claim

An eligible completed anonymous public run can return a private, short-lived,
single-use claim ticket so you can associate that run with your account. The
extension holds it only in popup memory: it is excluded from extension storage,
report links and reference exports. Closing the popup or starting another request
loses it. **Save this research to your account** deliberately opens the Keryx
claim page with the ticket in a URL fragment, which the website processes for
the claim flow. The link can be retained in browser history; treat it as a secret
and do not share it. Website sign-in and account ownership checks apply. Claiming
a run does not make its published question, answer or payment records private.

## Storage, retention and deletion

The extension uses `chrome.storage.local` on your device for the context-menu
handoff (selected question text, page URL and title until the popup consumes it)
and a list of at most ten completed public report URLs with timestamps. This
recent-report list contains no questions, answers, credentials or wallet keys.
It is local device history, without cloud synchronization by Keryx.

**Clear device list** removes the recent-report list only. It does not remove a
pending context-menu handoff, hosted reports, browser history, downloaded reference
exports, backups or disk remnants. Removing the extension removes its local
extension storage under the browser's normal uninstall behavior. Anyone controlling
your browser profile or device could access local data and exported files.

Published research and on-chain records are retained indefinitely. Contact us for
corrections or deletion requests concerning off-chain data; removal from the
service does not remove copies already published or downloaded by others. Stopping
observation in the popup does not cancel server work or an in-flight payment.

## Use, disclosure and contact

We use extension data to provide requested research, creator links, report access
and local history, and to operate and protect the service. We do not sell question
or wallet data to data brokers or use extension content for advertising. Data is
disclosed to the service providers needed for those operations, and submitted
public research is disclosed publicly as described above. Transfer uses HTTPS.

We will update the date when this policy changes. Questions, corrections or
off-chain deletion requests: [support@keryx.cc](mailto:support@keryx.cc).
Do not send passwords, private keys or recovery secrets.
