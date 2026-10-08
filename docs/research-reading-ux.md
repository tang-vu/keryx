# Research reading UX

## Feedback confirmation — October 8, 2026

The shared report's Helpful controls keep counts authoritative, distinguish sending,
recorded and unconfirmed feedback, and isolate response state to its report.
A failed response may follow a saved vote, so the client prevents another attempt
in that mounted report and does not promise safe retry. Headers and body observation
have a 15-second deadline; late results cannot erase uncertainty. Legacy Supabase
feedback errors propagate instead of false confirmation or zero counts. Controls have spoken names,
status announcements and 44px targets. This app0.27.33 candidate changes shared
chat/dispatch/desktop-hosted reports; compact embeds and text/native adapters keep
their existing roles. Browser/CI, coordinated release, physical-device use and
independent usefulness remain separate gates. See
[behavior, limits and acceptance](engineering/report-feedback-confirmation.md).

## Answer heading navigation — October 8, 2026

The answer renderer previously styled its recognized Markdown headings as
paragraphs. Native headings now expose those sections to browser accessibility
navigation. The shallowest recognized heading starts at h2; deeper headings retain
their relative depth, up to h4. This avoids a separate h1 for every report in a
conversation. The existing one-to-three-hash block grammar, typography, React text
escaping and keyboard citation controls remain unchanged.

The shared renderer covers public chat, saved reports, dispatches and reports opened
from desktop handoffs; the compact iframe embed also uses it. Native desktop-local
results, CLI, remote and stdio MCP, HTTP APIs, extensions and bots continue to
receive the existing text contract. Markdown export preserves the original heading
markers. No new payment, evidence or research authority follows from these semantics.

App0.27.31 is a candidate layered after the free bibliography candidate. TypeScript,
focused lint, the production build and built-CSS browser checks for heading levels,
inline formatting, safe text, keyboard citation activation/focus restoration and
small-screen layout are required before release. Physical screen-reader use,
the complete host-page heading hierarchy and real-reader usability remain separate
acceptance work. CI, coordinated merge, deployment and `/api/health` verification
are still release gates; this source change is not a deployed accessibility claim.

Local verification passed both TypeScript graphs, focused lint, the isolated
Next16.3.8 production build and the existing reading-evidence browser suite. A
disposable Chromium check exercised five heading/text cases with both full-report
and compact-renderer styles at320/390/768/1440px. It confirmed native heading
levels/names, inline formatting, escaped HTML, heading-citation keyboard activation
and restored focus, with no horizontal overflow. Both320px screenshots were read.
These checks used synthetic records and intercepted feedback GETs; they did not
exercise a physical screen reader or the complete iframe/research host flow.

## Chat-first research — October 1, 2026

The owner approved replacing the main reading flow with a question-led conversation
and a structured cited report. The shared client surface keeps prior turns while
the page remains open; reloading or leaving the page does not retain the conversation.
Completed reports remain accessible through their existing dispatch links. Production
availability requires the reviewed commit, successful CI and verified deployment.

Use the same chat surface on `/` and `/research`. Keep paid-package checkout,
recovery and private jobs accessible in a secondary section on `/research`, retaining
their existing prices, terms and authority. Lead the first screen with the composer
and a few examples rather than requiring a reader to choose a paid package first.

Show each submitted question with its research progress and resulting report. Keep
prior turns available within the current tab, and make research decisions and source
evidence expandable. The composer must show the selected source-USDC cap and payer;
settled, pending, failed, unverified and simulated amounts remain distinct. Public web
search disclosure and the separation of source USDC from search/model costs remain
available before submission.

The signature globe remains in the shared chat header on both routes. Reuse its
locally bundled country outlines and existing reduced-motion behavior, with a
bounded desktop placement and smaller mobile presentation. It is decorative and
must not intercept clicks, obscure the guide or text, or displace the composer.

Follow-ups use the existing prior-run anchor. The server carries only the previous
question, not the paid answer or the complete conversation. State that limit and
provide a deliberate new-topic action. Client stream cancellation does not prove a
refund or the final state of an already submitted authorization. Preserve observed
payment states in stopped turns and do not automatically repeat a request.

Copy and Markdown download retain source links, observed document provenance and
the evidence/payment states of the actual report. Contradictory settlement fields
are labeled unverified, and pending or simulated records never become settled merely
because a report cites their source. Clipboard failure leaves download available.

Each client request has an identity guard. A late response, interrupted error-body
read or stale stream cannot overwrite a newer request or expire its grant. This does
not replace the existing signing-budget identity check or alter durable reservations.
An expired funded session remains expired: its turn does not claim treasury fallback.

Responsive layout, keyboard use, stream errors,
stopped requests, multiple turns, settings persistence, signing regressions, relevant
tests, production build and internal review are release gates. Browser fixtures are
explicit simulations; actual user adoption and physical-device validation require
separate evidence.

Local Chromium checks of the built candidate kept the source cap before the send
button. At 320 and 390 pixels wide in a 640-pixel viewport, the input began around
y=327 and the action occupied y=576–624. At 1366×768, the input began around y=372
and the action occupied y=621–669. The checked layout dimensions had no horizontal
overflow. These are browser measurements, not physical-device or usability evidence.

The hermetic chat fixtures cover multiple turns, exact parent/cap/model submission,
new-topic errors followed by stopped/new requests, late transport responses, report
exports and expired/paused grants. A separate hook fixture reproduces the interrupted
401 error-body race and verifies that its old completion cannot replace a newer
finished request. Existing signing-budget, source payee and fetch-price tests remain
part of focused validation; no real wallet, search, model or payment call is made.

## September 28, 2026 milestone

This milestone changes the public reading experience on `/` and the related answer, archive, and creator entry surfaces. It does not change payment authority, grant rules, SSE framing, source selection, or settlement records. The existing browser session and Keryx treasury paths remain distinct, and the displayed payer follows the active or expired grant binding.

## Observed problem and delivered behavior

Before the change, a 1366×768 Chromium view placed the question input around y=1123, below a large masthead and other content. At 320×640 the input was around y=1500. The initial viewport therefore delayed the core action. The completed answer was below tall decision and creator-payment panels, so a reader had to pass the trace before reaching the result. Small labels and controls made the first ask harder to scan. Potential mobile horizontal overflow was an audit risk, but the measured baseline page did **not** overflow at 320px; this milestone does not claim to fix a reproduced overflow defect.

The compact hero now puts a plain explanation, question, Quick/Deep choice, and Ask Keryx action in the first flow. Budget and AI model follow in a native disclosure, while the selected maximum and payer appear beside the action. Two example questions remain visible as optional starting points. The user-invoked guide sits in the hero instead of covering mobile controls. Streaming shows the latest research step, confirmed settled spend, and separate pending or simulated amounts; full BUY/SKIP/CACHE and payment evidence is available in an expandable panel. Once available, the cited answer precedes that detailed panel. Payment labels preserve settled, pending, failed, unverified, and simulated distinctions; a citation alone is not a settlement claim.

At 320, 360, and 390px wide, a local Chromium run of the Next page with fonts ready placed the question around y=311 and the action from y=518 to y=566 in a 640px viewport. At 1366×768 they were around y=405 and y=612–660. The checked widths (320, 360, 390, 430, 768, 1024, 1366, and 1440px) had no document-level horizontal overflow. A short 390×480 viewport showed the top of the question around y=311, while the action required scrolling. These are local browser measurements, not claims about the pending Linux CI rerun, physical devices, or every content state.

## Checks and release gates

`npm run test:browser-research-ux` runs against a built Next app in explicit offline mode, or a local URL supplied with `KERYX_UX_BASE_URL`. It combines a hermetic form test, synthetic answer/payment evidence checks, responsive screenshots and assertions, and browser checks for ticker, navigation, and guide behavior. The layout test blocks every API write and external request; component checks intercept HTTP. CI installs Chromium, builds the app, runs this command, and retains layout screenshots. TypeScript, focused ESLint, and the production build remain required for the release.

Remaining acceptance work is explicit: validate the first ask on physical small-screen devices and with long translated text; observe real-reader use and task completion; confirm example prompts and any future source previews against current, real content; and assess answer quality and source choice separately from layout. No traction, settlement, or research-quality improvement is inferred from this UI check.

The creator URL helper formats the submitted URL for review; it does not fetch or verify a live article preview. Manually curated archive examples were considered during the audit but are not shipped in this milestone. A future example or preview must be grounded in a current, real source before release.
