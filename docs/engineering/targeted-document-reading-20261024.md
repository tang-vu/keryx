# Bounded reading of an explicit HTML heading section

One caller-supplied fragment can select a literal heading ID, or an empty visible
legacy named/ID anchor immediately before a heading. The reader captures that
heading, its subordinate headings and following siblings, ending before a peer
or higher heading or the enclosing parent end. It scans through EOF before
accepting the unique anchor. Missing, duplicate, hidden, navigation, template,
foreign-content and unsupported structural targets refuse extraction.

The isolated worker first scans the admitted HTML with parse5's SAX parser. It
retains ancestor state and a selected source range instead of building the full
document tree. Direct optional list, paragraph and table end tags are supported;
formatting reconstruction, ambiguous nested boundaries and other tree repair
are refused. The selected range then passes through the existing DOM extractor.
This is deliberately narrower than browser anchor navigation.

The original 2 MiB transport/input, 64 MiB child heap, four-second extraction
deadline, parser admission, depth 256, 20,000 DOM elements, 500,000 normalized
bytes and 60,000 output characters remain. The SAX pass admits at most 200,000
token events and at most 500,000 UTF-8 selected-source bytes. No script or linked
resource executes. Existing public-only fetch and cancellation stay authoritative.

Requested selectors travel separately from the canonical fetch URL. The caller's
selector is matched against the actual final document; a redirect's absent,
replacement or empty fragment does not change that explicit intent. The actual
final URL is never replaced with the requested URL. Multiple distinct fragments,
mixed document/section requests, PDF and plain-text responses retain bounded
whole-document mode. Existing heading hints within extracted text remain.

Successful reads record `bounded-heading-section` and optional
`keryx-html-section-scope-v1` metadata: exact decoded fragment, heading rank,
UTF-16 start/end offsets and length of the decoded HTML input, and SHA-256 of
that input encoded as UTF-8. These are not quote offsets or a raw transport-byte
digest. Quote/layout offsets still refer to the extracted text. Section reads
are conservatively marked truncated: the rest of the document was not read.
Historical absence supplies no section coverage. No source/reward authority changes.

Observed section scope survives the report, decisions, evidence/citations,
portable research receipt and completed-read draft import/restore/export.
Markdown and LaTeX exports disclose the section-only boundary. Draft-editor
quote controls remain unchanged; the report/receipt/export carries the detailed
HTML read scope. Web, API, ask CLI, hosted MCP and bots inherit the shared reader;
desktop, stdio MCP and extension retain their hosted handoff and local-inspection
roles. No new tool, signing authority, payment, schedule or automatic retry exists.
An isolated esbuild import graph reaches the changed draft/scope modules from
stdio MCP and the scope module from the desktop helper; the desktop renderer
does not reach changed runtime code. Their affected packages therefore need
coordinated publication acceptance and release-owner version allocation in the
runtime batch. Exact-source CI/build acceptance remains required; source
acceptance is not installed-client or production proof.

The retained 1,726,689-byte FFmpeg original now yields the `loudnorm` section
through the normal isolated worker, including four measured inputs, dynamic-mode
fallback conditions and output-rate qualification. The record remains a local
extraction observation, not a fresh research run, model-quality result or proof
of the historical transport failure's cause. Required focused regressions cover
the long-document case, late duplicate IDs, visibility, inert/foreign content,
optional tags, unsupported repair, resource bounds, redirects, shared-agent
plumbing and portable scope preservation. Required CI remains the merge gate.
