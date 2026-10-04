# Original-read and research-recovery follow-up

Application 0.26.7 was released at `6562ebe` after independent review and required
CI. Public health, homepage, hosted roles and the actual assembled readers were
verified; private-worker restoration remained a separately recorded operations gate.
This follows the [24-task baseline](research-workload-2026-10-04.md)
at `3c29d7ad44b0af0b809d721602add3b27f5f6b14`. These are internal evaluation tasks,
not independent customer acceptance or traction.

## Reader changes and evidence

Seven failed HTML/byte-limit cases were replayed against identical retained raw
bytes. Script-heavy Stripe, pgvector and Vercel pages exceeded the old raw HTML
limit; Auth0, Chrome, arXiv and Supabase exhausted the full DOM's 64 MiB old-space
setting. Standards-based normalization and a lightweight DOM allow those documents
through the same child deadline and memory setting. The normalized markup limit
remains 500 kB; raw transport remains bounded at 2 MiB. Explicit semantic content
preserves headings and caveats lost by a heuristic-only extraction in this corpus.

Independent review reproduced fidelity defects in the initial candidate:
related article cards could override the actual main document, and hidden text
could enter evidence, including when an invalid CSS declaration overrode valid
hiding. All were corrected and the focused regression fixtures passed; the reviewer
repeated the adversarial probes and reported no outstanding findings. Static
HTML extraction does not implement browser layout or guarantee that all relevant
content has been read. Unknown CSS declarations do not cancel a known static hide;
CSS variables, external stylesheets and JavaScript are not evaluated. The arXiv v1
text exceeds the 60,000-character output limit
and remains explicitly truncated.

Neon serves a Markdown response, now read as bounded inert text. NASA's hostname
resolved to public IPv6 and IPv4 addresses; choosing IPv6 failed on the evaluation
host. Validate the complete DNS answer set, then prefer one public IPv4 address.
IPv6-only hosts retain their address, TLS retains the original hostname, and no
additional request or automatic fallback is introduced.

The final fresh capture read all 22 distinct public URLs, versus 13/22 in the
baseline. The fictional text PDF remains readable and its image-only counterpart
remains unavailable. Both the arXiv HTML and fictional revision-2 fixture carry
truncation. Retain prior captures and failed replay attempts separately; recapturing
the current web is not a byte-identical benchmark. The seven retained-HTML probes
above provide the controlled reader comparison.

Offline heuristic replay completed 18/18 pipelines versus 16/18 previously. It
attempted only nine snapshot reads and retained five citations, with zero payment
attempts or records. R01/R18 no longer throw, but the heuristic selected no sources
for them. The fixed fallback keeps explicit question/semicolon boundaries and all
requested wording; comma/conjunction refinements apply only within the existing
eight-target cap. More than eight explicit targets still fail visibly. This does
not demonstrate useful decomposition or completion of the requested decisions.

R13 now includes exact-version text-layer recovery and says no OCR occurred; R14
requests the missing section of the same version and retains the old snapshot.
R11 conflict guidance passes synthetic focused checks but is not exercised by the
heuristic, which emits no conflicts. At the reader checkpoint no post-change model
batch had run; the previous 1 narrowly usable / 11 partial / 6 rejected assessment
was not superseded by the offline results. The owner subsequently approved a
separate additional USD 1 comparison. Its results and newly observed identity/context
defects are recorded in [the follow-up](research-evidence-follow-up-2026-10-04.md).

TypeScript and lint pass (five pre-existing warnings). Focused reader, transport,
fallback and saved-surface regressions pass. The first integrated check caught an
inline-detail contract regression; moving the appendix to the full answer preserves
that contract and all payment-priority branches. A subsequent clean CI run passed
3,524 tests with four configured skips and built the application, then exposed the
compiled-test locator's assumption that every export has an explicit numeric ID
and synchronous initialization. Structural export-key discovery and awaited module
exports retain the same behavior assertions; six locator regressions cover the
observed formats and refuse ambiguous or unsupported identities.

A separate clean Windows checkout with physical dependencies and npm 11.19.0
reproduced the original locator failure, then passed the corrected minified
orchestrator checks and assembled HTML/PDF runtime test. The earlier full Windows
run against shared dependencies was stopped incomplete after retained failures and
slow execution; it is not a passing full-suite result. Final required PR checks and
main CI passed, including the corrected production tests; downloaded MCP/desktop
assets matched their exact-source manifests and embedded source identity. Published
MCP/desktop remain 0.4.3 and the existing extension remains 0.1.1. These observations
do not establish acceptance of every installed client or complete research output.
Source-reading results cannot establish complete synthesis,
independent discovery recall, current commercial applicability or billing costs.

## Actionable incomplete results

Saved reports now explain the actual unavailable read and suggest a bounded next
step: obtain a text-layer PDF or publisher text for the same version, read the
missing part of a truncated document, or obtain the full text behind an abstract.
An observed image-only PDF failure does not become OCR evidence. A model flag for
conflicting sources asks for original passages, revisions and document authority;
its preferred answer is not a resolution.

The appendix is assembled after attribution and settlement. It performs no read or
purchase and cannot create a citation, new evidence eligibility, creator weight or
refund. Pending/unknown payment guidance takes priority over any further paid
attempt. A mixed paid-source/failed-public-PDF regression checks that the saved
answer, Markdown export, receipt and hosted adapters preserve the guidance without
changing the original contribution input or recorded spend.

## Supported surfaces and release scope

Web and shared research APIs deliver the stored final answer, including its next
steps. Remote MCP and A2A reuse the same result; OpenAI-compatible text responses
and saved Markdown reports preserve it. Receipt/reference/evidence metadata retain
their existing contract. Buyer/Operator CLI, stdio MCP and desktop keep their
existing server/handoff roles; they do not gain a new local paid-research engine.
Extensions and bots keep their existing display/handoff boundaries. Installed
client or GUI acceptance is not inferred from shared adapter tests.

The application version changes to 0.26.7. Desktop/MCP remain 0.4.3 and extension
0.1.1 because no client contract or bundled client behavior changes; verify actual
release assets and registry versions separately before claiming distribution.
No database, registry, custody, signer, cap or scheduler migration is introduced.
Deploy current `origin/main` with the documented mainnet flow, preserve existing
economic role holds, and verify public health plus worker restoration.

## Remaining product gate

D-300 still delivers qualified excerpts with Low/incomplete-synthesis confidence.
The original acceptance required decisions, comparisons and checklists. Reading
more sources and offering recovery can improve the ingredients without satisfying
those finished artifacts. B04/B05 need a reviewed assertion-completeness and
entailment design, adversarial cases and actual usefulness review. A quote-only
comparison worksheet is not silently accepted as a finished decision. No additional
model allowance or mainnet source spend follows from these code changes.
