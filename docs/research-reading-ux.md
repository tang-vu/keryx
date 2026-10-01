# Research reading UX

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
