# Inline heading fragment anchors

An explicitly requested HTML fragment can name a visible inline element inside
an `h1`–`h6`, such as `<h2><span id="limits"></span>Limits</h2>` or
`<h4>The <dfn id="limits"><code>limits</code></dfn> condition</h4>`.
The section scanner previously refused these targets or treated an empty inline
named anchor as a possible marker for a later heading. It now selects the entire
owning heading and its following section.

Public markup observed on November 8, 2026 includes the empty `span` IDs
`headings-and-outlines` and `outlines` inside a heading in the
[WHATWG sections document](https://html.spec.whatwg.org/multipage/sections.html#headings-and-outlines),
and event `dfn` IDs inside headings in the
[W3C Clipboard draft](https://www.w3.org/TR/clipboard-apis/#eventdef-globaleventhandlers-copy).
These are markup observations, not a claim that either complete page passes every
conservative parser restriction. Committed tests use synthetic documents.

Only the scanner's explicit supported inline elements and an uninterrupted chain
of those elements may connect the target to a still-open heading. It does not
infer an earlier/later heading for a generic container, paragraph, form control,
foreign element or block wrapper. Existing empty named anchors immediately before
a heading and heading-first semantic sections retain their behavior.

The original heading's level and parent determine the existing peer-heading or
parent-close boundary. The full heading, including text before the target, counts
against the selected-section limit. Hidden/inert targets, visibility resets under
hidden ancestors, duplicate anchors anywhere in the complete input, malformed
trees and ambiguous nested peer boundaries remain refusals.

The existing `keryx-html-section-scope-v1` records the original document hash and
UTF-16 offsets from the opening heading through the selected boundary. The public
article reader preserves the caller's selector separately from redirected URL
identity; gathered evidence and receipt assets retain this exact scope and the
partial-document label. Mixed whole-document/section requests still read in
whole-document mode. No confidence, payment, receipt schema or access policy is
changed. Parser input/depth/token/element/output limits, process isolation and
admission remain unchanged.

Web/API and research surfaces consuming the shared reader receive this behavior
when that source is released. Desktop, CLI, MCP, extension and bot adapters keep
their existing roles and public contracts; no adapter-specific fetch path or
distribution version is introduced. Source acceptance does not establish live
publisher access, independent usefulness, spending or settlement evidence.
