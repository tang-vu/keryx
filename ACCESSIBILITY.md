# Accessibility

Last reviewed: October 22, 2026.

Keryx aims to make research questions, cited answers, source evidence and payment
state usable with a keyboard, assistive technology and different screen sizes.
We use WCAG 2.2 Level AA as a design and review target. We have not completed a
comprehensive independent audit and do not claim full WCAG conformance.

## Environments and current work

The web interface targets current desktop and mobile browsers with JavaScript
enabled. Automated interaction and layout checks primarily use Chromium; these
checks do not certify every browser, device or assistive-technology combination.
The native desktop app targets Windows x64 with WebView2. The extension targets
Chromium Manifest V3 browsers. CLI, API, MCP and bot integrations expose text or
structured output, with presentation partly controlled by the receiving client.

Current web work includes semantic report headings, named citation controls,
keyboard interaction and focus restoration in tested report/dialog flows,
responsive reading layouts, and reduced-motion styles. See the scoped evidence in
[research reading UX](docs/research-reading-ux.md) and
[stored excerpt readability](docs/engineering/evidence-readability-2026-10-08.md).
Those records describe particular source versions and test cases; they are not a
claim about every page or an installed release.

## Known limitations

- Full end-to-end testing with physical screen readers, switch/voice input and
  diverse mobile devices remains incomplete. Browser fixture checks cannot replace
  testing by people using those tools.
- A complete audit of contrast, zoom/reflow, focus order and announcements across
  all routes, locales, errors and payment states has not been completed.
- Wallet providers, login prompts, native file dialogs and third-party source
  documents have their own interfaces. We cannot guarantee their accessibility;
  reports should identify which step and provider caused a barrier.
- Rich source documents, PDFs and decorative visualizations may not provide the
  same experience as the surrounding text. Plain-text answers and recorded exports
  can help where available, but are not a complete substitute for accessible source
  material or a fix for every workflow.

## Report a barrier

Open an [accessibility issue](https://github.com/tang-vu/keryx/issues/new?template=03-accessibility.yml)
or email [support@keryx.cc](mailto:support@keryx.cc) with an `Accessibility:` subject.
English and Vietnamese reports are welcome. You do not need to identify a WCAG
criterion or disclose a disability to report a problem.

If possible, include the page or app surface, what you tried to do, the barrier,
browser/OS and assistive technology versions, and the behavior you expected. A
redacted screenshot or short recording is optional. Keep account details, questions,
wallet keys and private payment records out of public issues.

Maintainers will use reports to reproduce and prioritize barriers, discuss available
workarounds and track fixes. There is no guaranteed resolution deadline. Report
security-sensitive details through the [private security channel](SECURITY.md).

## Contributor checks

For changed UI, check keyboard-only operation, visible focus and return focus,
accessible names and status messages, readable contrast, zoom/reflow and narrow
viewports. Respect reduced-motion preferences. Test relevant screen-reader flows
when possible and record the environment and limitations. Update this statement
when supported environments or known barriers change.
