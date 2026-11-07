# Title fidelity for selected HTML sections

Supported heading-section reads retain the first nonempty document-head title.
SVG and inert template titles do not supply or append document metadata. Title
whitespace is normalized before clipping, just as in whole-document extraction.
The scanner retains at most 202 UTF-16 units of normalized title prefix; two
lookahead units preserve a complete codepoint beyond the final 200-unit cap.
The ordinary content worker still applies that final cap and hostname fallback.

The real-worker regression compares selected sections with whole-document reads
for Unicode boundaries, leading whitespace, decoded entities, SVG/template titles
and multiple head titles. The previous source failed eight of the twelve added
comparisons, including a lone high surrogate and `Original manualGraphic annotation`.
The selected body, fragment, source offsets, document hash and partial-read scope
remain unchanged. These metadata checks do not establish source accuracy or raise
answer confidence.

The existing input/element/depth/token/byte/output/deadline and parser-admission
limits remain in force. Next's existing worker allowlist includes the reused
Unicode helper. Hosted production acceptance checks the assembled reader trace;
no deployment, package publication or version change accompanies this source fix.
