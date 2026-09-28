# Research reading UX milestone — September 28, 2026

This milestone changes the public reading experience on `/` and the related answer, archive, and creator entry surfaces. It does not change payment authority, grant rules, SSE framing, source selection, or settlement records. The existing browser session and Keryx treasury paths remain distinct, and the displayed payer follows the active or expired grant binding.

## Observed problem and delivered behavior

Before the change, a 1366×768 Chromium view placed the question input around y=1123, below a large masthead and other content. At 320×640 the input was around y=1500. The initial viewport therefore delayed the core action. The completed answer was below tall decision and creator-payment panels, so a reader had to pass the trace before reaching the result. Small labels and controls made the first ask harder to scan. Potential mobile horizontal overflow was an audit risk, but the measured baseline page did **not** overflow at 320px; this milestone does not claim to fix a reproduced overflow defect.

The compact hero now puts a plain explanation, question, Quick/Deep choice, and Ask Keryx action in the first flow. Budget and AI model follow in a native disclosure, while the selected maximum and payer appear beside the action. Two example questions remain visible as optional starting points. The user-invoked guide sits in the hero instead of covering mobile controls. Streaming shows the latest research step, confirmed settled spend, and separate pending or simulated amounts; full BUY/SKIP/CACHE and payment evidence is available in an expandable panel. Once available, the cited answer precedes that detailed panel. Payment labels preserve settled, pending, failed, unverified, and simulated distinctions; a citation alone is not a settlement claim.

At 320, 360, and 390px wide, a local Chromium run of the Next page placed the question around y=379 and the action from y=585 to y=633 in a 640px viewport. At 1366×768 they were around y=405 and y=612–660. The checked widths (320, 360, 390, 430, 768, 1024, 1366, and 1440px) had no document-level horizontal overflow. A short 390×480 viewport showed the top of the question around y=379, while the action required scrolling. These are browser measurements, not claims about physical devices or every content state.

## Checks and release gates

`npm run test:browser-research-ux` runs against a built Next app in explicit offline mode, or a local URL supplied with `KERYX_UX_BASE_URL`. It combines a hermetic form test, synthetic answer/payment evidence checks, responsive screenshots and assertions, and browser checks for ticker, navigation, and guide behavior. The layout test blocks every API write and external request; component checks intercept HTTP. CI installs Chromium, builds the app, runs this command, and retains layout screenshots. TypeScript, focused ESLint, and the production build remain required for the release.

Remaining acceptance work is explicit: validate the first ask on physical small-screen devices and with long translated text; observe real-reader use and task completion; confirm example prompts and any future source previews against current, real content; and assess answer quality and source choice separately from layout. No traction, settlement, or research-quality improvement is inferred from this UI check.

The creator URL helper formats the submitted URL for review; it does not fetch or verify a live article preview. Manually curated archive examples were considered during the audit but are not shipped in this milestone. A future example or preview must be grounded in a current, real source before release.
