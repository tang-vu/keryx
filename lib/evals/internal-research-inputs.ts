import type { InternalResearchInput } from "./internal-research-input-types";

const checked = "Primary page readable in the authoring browser check on 2026-10-04. URL availability is not an execution read, complete coverage, or task acceptance.";
const waterCycle = {
  title: "NASA GPM: The Water Cycle",
  url: "https://gpm.nasa.gov/education/water-cycle",
  observedScope: checked,
};

/**
 * Internal examples supplement the R01-R18 specification; none is a customer request.
 * Public text must come from the execution reader, not this author's browser check.
 * Synthetic documents are fictional and cannot evidence real provider or paper claims.
 * Prepared against repository 3c81ee981d9b06c315f0602fb874bd16cfc0ca88.
 */
export const INTERNAL_RESEARCH_INPUTS: InternalResearchInput[] = [
  {
    id: "R01",
    inputKind: "public-original",
    question: "Internal design exercise: choose SQLite WAL or rollback journals for a single-host API on local SSD, with 20 concurrent readers, one application writer and nightly recoverable backups. These workload counts are assumptions, not benchmarks. Compare concurrency, power-loss durability and live backup handling; identify measurements and runtime-version checks still needed before choosing.",
    targets: ["Reader/writer concurrency and busy handling", "Durability and checkpoint assumptions", "Consistent backup and restore checklist", "Conditional choice and unresolved measurements"],
    sources: [
      { title: "SQLite: Write-Ahead Logging", url: "https://www.sqlite.org/wal.html", observedScope: checked },
      { title: "SQLite: Online Backup API", url: "https://www.sqlite.org/backup.html", observedScope: checked },
      { title: "SQLite: File Locking And Concurrency", url: "https://www.sqlite.org/lockingv3.html", observedScope: checked },
    ],
    expectedArtifact: "A conditional decision brief and backup/restore checklist.",
    review: ["Separate concurrency, durability, backup and SQLite-version constraints.", "Do not claim assumed workload throughput was measured.", "State that copying a live database file alone is not a demonstrated consistent backup.", "Current extractive delivery may pass provenance while failing the requested decision brief."],
  },
  {
    id: "R02",
    inputKind: "public-original",
    question: "Internal design exercise: a Stripe subscription webhook consumer receives duplicate and out-of-order events; its worker may crash after updating a local entitlement but before acknowledging the job. Produce a durable state-transition checklist covering receipt verification, event identity, processing, failure, unknown external effects and reconciliation. Do not send a webhook or change a real entitlement.",
    targets: ["Stripe delivery ordering and duplicate contract", "Durable receipt and processing states", "Crash recovery and unknown outcomes", "Limits of exactly-once effects"],
    sources: [{ title: "Stripe: Receive Stripe events in your webhook endpoint", url: "https://docs.stripe.com/webhooks", observedScope: checked }],
    expectedArtifact: "State-transition checklist and failure table.",
    review: ["Use observed Stripe documentation for delivery semantics.", "Do not promise exactly-once external execution or use event arrival order as business ordering.", "Label local state-machine and reconciliation choices as design proposals.", "Keep received, processed, failed and externally unknown states distinct."],
  },
  {
    id: "R03",
    inputKind: "public-original",
    question: "Internal design exercise: a three-person team already runs PostgreSQL and needs 1,000 document-processing jobs per day, each lasting up to five minutes. Compare a proposed jobs table using row locks/SKIP LOCKED with Amazon SQS Standard. Jobs can be interrupted after an external effect, and duplicating that effect is unacceptable. Propose recovery and a conditional choice without pretending the assumed load or costs were measured.",
    targets: ["PostgreSQL claim and recovery mechanism", "SQS visibility timeout and redelivery", "Business effect deduplication and unknown outcomes", "Operational assumptions and conditional choice"],
    sources: [
      { title: "PostgreSQL SELECT documentation (current resolved to 18 at authoring)", url: "https://www.postgresql.org/docs/current/sql-select.html", observedScope: checked },
      { title: "AWS: Amazon SQS visibility timeout", url: "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html", observedScope: checked },
    ],
    expectedArtifact: "Options table with an explicitly conditional recommendation.",
    review: ["A visibility timeout is not a guarantee that business work executes once.", "SKIP LOCKED alone does not implement a complete durable job queue.", "Distinguish source-supported primitives from the proposed application design.", "Keep throughput, monthly cost and operational burden unmeasured."],
  },
  {
    id: "R04",
    inputKind: "public-original",
    question: "Internally authored migration example, not the installed Keryx stack: evaluate @auth0/nextjs-auth0 3.5.0 to exactly 4.0.0 for a Next.js App Router application using login/logout, middleware, server-side session reads and an access-token call. Identify documented breaking changes, required runtime compatibility, proposed regression tests and session/rollback questions. Later v4 features must not be attributed to 4.0.0 without version evidence.",
    targets: ["Exact SDK release identities and supported runtime", "Routes, middleware and session API changes", "Access-token changes and proposed tests", "Rollback and existing-session uncertainties"],
    sources: [
      { title: "Auth0 Next.js SDK release v3.5.0", url: "https://github.com/auth0/nextjs-auth0/releases/tag/v3.5.0", observedScope: checked },
      { title: "Auth0 Next.js SDK release v4.0.0", url: "https://github.com/auth0/nextjs-auth0/releases/tag/v4.0.0", observedScope: checked },
      { title: "Auth0 Next.js SDK v4 migration guide (mutable main)", url: "https://github.com/auth0/nextjs-auth0/blob/main/V4_MIGRATION_GUIDE.md", observedScope: `${checked} Mutable main guide may contain later v4 changes; 4.0.0 applicability needs release-bound evidence.` },
    ],
    expectedArtifact: "Exact-version migration note with proposed tests and rollback gates.",
    review: ["Keep the internal example separate from Keryx's installed versions.", "Do not conflate a mutable v4 guide with the exact v4.0.0 release contract.", "Distinguish observed breaking changes from suggested tests.", "Leave unsupported session migration and rollback behavior open."],
  },
  {
    id: "R05",
    inputKind: "public-original",
    question: "Internal design exercise: a public API reads GitHub REST metadata using one shared provider identity for 20 callers. Design per-caller admission plus a global quota and a bounded retry policy for primary and secondary rate limits. Use a proposed ceiling of three attempts and a two-minute user deadline; do not treat those proposed settings as GitHub's policy. Discuss Retry-After, reset headers and the difference between retrying reads and side-effecting work.",
    targets: ["HTTP 429 and Retry-After semantics", "GitHub primary and secondary limit responses", "Shared and per-caller admission", "Finite retries, deadline and side-effect boundary"],
    sources: [
      { title: "GitHub: Rate limits for the REST API", url: "https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api", observedScope: checked },
      { title: "IETF RFC 6585: Additional HTTP Status Codes", url: "https://www.rfc-editor.org/rfc/rfc6585", observedScope: `${checked} Authoring browser redirected to the RFC information page; execution must distinguish metadata from the RFC text.` },
    ],
    expectedArtifact: "Quota and bounded-retry checklist.",
    review: ["A per-caller cap alone does not bound shared provider usage.", "Differentiate GitHub 403/429 behavior and changing secondary limits.", "Stop or defer when provider backoff exceeds the user's deadline.", "Do not describe request caps as a measured monetary-cost guarantee."],
  },
  {
    id: "R06",
    inputKind: "public-original",
    question: "Internal design exercise: compare exact pgvector search with HNSW for 25,000 vectors of 768 dimensions, 100 daily updates and an assumed p95 target of 200 ms. Missing a relevant safety document is costly. These are proposed constraints, not observed results. Specify a corpus-bound recall/latency evaluation, filter handling and a conditional choice.",
    targets: ["Exact versus approximate search guarantee", "HNSW tuning and filtered-search limits", "Corpus-bound recall and latency measurement plan", "Conditional choice under unmeasured workload"],
    sources: [{ title: "pgvector maintainer README", url: "https://github.com/pgvector/pgvector", observedScope: `${checked} Mutable repository documentation; execution must retain its observed snapshot.` }],
    expectedArtifact: "Decision brief and proposed recall/latency measurement plan.",
    review: ["Do not infer achieved recall or latency from the target or an unrelated benchmark.", "State corpus size, dimensionality, filters and update assumptions.", "Keep evaluation proposals distinct from measured results.", "Do not claim exact nearest-neighbor retrieval proves a document is semantically relevant."],
  },
  {
    id: "R07",
    inputKind: "public-original",
    question: "Internally authored affectedness example, not Keryx's installed dependency: a self-hosted application runs next 15.2.2, uses middleware as its only authorization check for /admin, and proposes next 15.2.3 specifically for GHSA-f82v-jwr5-mffw / CVE-2025-29927. Build an affectedness matrix from the maintainer advisory, identify the documented patch for this advisory and propose verification. Do not claim 15.2.3 is the currently secure or recommended production release against all later advisories.",
    targets: ["Advisory identity, affected version range and patch", "Middleware authorization and deployment preconditions", "Suggested upgrade and authorization regression checks", "Limits of advisory-specific affectedness"],
    sources: [
      { title: "Next.js maintainer advisory GHSA-f82v-jwr5-mffw", url: "https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw", observedScope: checked },
      { title: "Vercel postmortem on Next.js middleware bypass", url: "https://vercel.com/blog/postmortem-on-next-js-middleware-bypass", observedScope: `${checked} Authoring request to nextjs.org/blog/cve-2025-29927 redirected here.` },
    ],
    expectedArtifact: "Advisory-specific affectedness matrix and upgrade verification checklist.",
    review: ["Do not report Keryx production as affected by this fictional installed-version example.", "Package-name or version matching alone does not establish every deployment is exploitable.", "Bind the patch conclusion to this exact advisory.", "No exploit requests, production scans or dependency writes belong to this task."],
  },
  {
    id: "R08",
    inputKind: "public-original",
    question: "Internal Chrome Manifest V3 extension design: a context-menu item sends only the user's selected text to a research page after a click; a second item opens a fixed source-registration URL. The extension does not scrape the page, inject code or read browsing history. Map the minimum permissions to these two features, and explain what additional feature would justify activeTab or host access.",
    targets: ["Selected text from a context-menu click", "Opening a known URL and tabs permissions", "activeTab and host access feature boundaries", "Minimal manifest permission proposal"],
    sources: [
      { title: "Chrome Extensions: contextMenus API", url: "https://developer.chrome.com/docs/extensions/reference/api/contextMenus", observedScope: checked },
      { title: "Chrome Extensions: tabs API", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", observedScope: checked },
      { title: "Chrome Extensions: activeTab permission", url: "https://developer.chrome.com/docs/extensions/develop/concepts/activeTab", observedScope: checked },
    ],
    expectedArtifact: "Permissions-to-feature mapping and a proposed minimal permission list.",
    review: ["Do not equate selected-text click data with arbitrary page access.", "Do not require tabs merely because the code calls tabs.create; check the documented operation.", "Justify each proposed permission from the stated feature.", "This is a design exercise, not installation or user-data collection."],
  },
  {
    id: "R09",
    inputKind: "public-original",
    question: "Compare exactly arXiv 2606.02668v1 and 2607.13716v1 on approval/action binding, runtime-state changes, expiry/replay and audit evidence. Retain exact-version excerpts and exportable references. Mark unread or truncated sections and unsupported dimensions. Carry forward Keryx issue #128; two successful reads do not by themselves establish a useful comparison or full-paper coverage.",
    targets: ["Approval-to-action binding", "Runtime-state changes between approval and execution", "Expiry and replay protection", "Audit evidence and stated limitations"],
    sources: [
      { title: "arXiv 2606.02668v1 (exact requested version)", url: "https://arxiv.org/html/2606.02668v1", observedScope: `${checked} HTML displayed arXiv:2606.02668v1. No paper text is frozen into this module.` },
      { title: "arXiv 2607.13716v1 (exact requested version)", url: "https://arxiv.org/html/2607.13716v1", observedScope: `${checked} Exact v1 HTML URL was readable. No paper text is frozen into this module.` },
    ],
    expectedArtifact: "Dimension-by-dimension comparison with exact excerpts and reference exports.",
    review: ["Keep both exact v1 identities; never substitute fictional corpus claims.", "Bind admitted excerpts to the actually observed article/version and read scope.", "Label truncated and unavailable dimensions explicitly.", "Source-boundary acceptance and intended comparison acceptance require separate review."],
  },
  {
    id: "R10",
    inputKind: "synthetic",
    question: "Fictional frozen abstract-only exercise: what does the supplied Lumen paper abstract establish about its method and results, and what remains unknown about samples, statistical uncertainty and generalization? No full paper is available. Produce an abstract-bounded note without reconstructing missing sections.",
    targets: ["Method stated in the abstract", "Results stated in the abstract", "Missing experimental detail", "Read scope and citation limitations"],
    sources: [{
      title: "Fictional Lumen study: abstract only, revision 1",
      text: "FICTIONAL INTERNAL FIXTURE - not a real paper. Lumen abstract, revision 1: We compare manual tagging with a rule-based tagger on a small collection of demonstration documents. The rule-based tagger reduced the number of tags that staff had to enter. The abstract does not state the document count, the reduction percentage, statistical uncertainty or results on an external dataset. Only this abstract is supplied; methods, tables and appendices are unavailable.",
      observedScope: "Frozen author-written abstract only. No full-paper request, document extraction or experiment occurred.",
      fixture: { kind: "abstract", version: "1", truncated: false, originId: "fictional-lumen-abstract" },
    }],
    expectedArtifact: "Abstract-bounded research note with explicit unknowns.",
    review: ["Keep the fictional/abstract-only label in report and exports.", "Do not invent sample size, effect size, uncertainty or full-text access.", "Report only the qualitative result available in the abstract.", "Missing experimental details are unknown, not proof that the study lacked them."],
  },
  {
    id: "R11",
    inputKind: "synthetic",
    question: "Fictional policy-conflict exercise: two supplied copies both claim Meridian retention policy revision 4 dated 2026-08-01, but disagree. Which retention period can a team safely treat as authoritative from these inputs, and what clarification is required? Do not invent precedence or silently choose a copy.",
    targets: ["Copy A retention claim", "Copy B retention claim", "Shared revision and unresolved contradiction", "Required authority clarification"],
    sources: [
      { title: "Fictional Meridian retention policy r4, copy A", text: "FICTIONAL INTERNAL FIXTURE. Meridian retention policy revision 4, dated 2026-08-01, copy A: Stored questions are deleted after seven days. This copy supplies no precedence rule or signed publication record.", observedScope: "Complete frozen excerpt A; no external policy or customer data.", fixture: { kind: "versioned-text", version: "4-copy-a", originId: "fictional-meridian-policy" } },
      { title: "Fictional Meridian retention policy r4, copy B", text: "FICTIONAL INTERNAL FIXTURE. Meridian retention policy revision 4, dated 2026-08-01, copy B: Stored questions are deleted after thirty days. This copy supplies no precedence rule or signed publication record.", observedScope: "Complete frozen excerpt B; no external policy or customer data.", fixture: { kind: "versioned-text", version: "4-copy-b", originId: "fictional-meridian-policy" } },
    ],
    expectedArtifact: "Conflict note preserving the unresolved decision and needed clarification.",
    review: ["Quote both seven and thirty days with their copy identities.", "Do not average periods or invent newest-copy precedence from identical dates.", "An explicit unresolved result can pass the evidence boundary while leaving the business decision incomplete."],
  },
  {
    id: "R12",
    inputKind: "synthetic",
    question: "Fictional copied-study exercise: three supplied publications describe improved sorting time. Map the evidence origins and count independent experiments, distinguishing repeated reporting from replication. Do the inputs establish that the result generalizes beyond the original team's participants?",
    targets: ["Original experiment identity and scope", "Copy B attribution", "Copy C attribution", "Independent support and generalization limits"],
    sources: [
      { title: "Fictional Aster lab report experiment A17", text: "FICTIONAL INTERNAL FIXTURE. Aster lab report A17, revision 1: In one internal experiment with twelve staff members, median card-sorting time was eight minutes with the old labels and six minutes with the revised labels. No external participant experiment or replication is reported.", observedScope: "Frozen original fictional experiment description.", fixture: { kind: "text", originId: "fictional-aster-a17" } },
      { title: "Fictional Beacon newsletter copy of A17", text: "FICTIONAL INTERNAL FIXTURE. Beacon newsletter: We reproduce the findings of Aster lab report A17 revision 1: twelve staff members, median sorting time eight minutes with old labels and six with revised labels. We collected no additional data.", observedScope: "Frozen derivative explicitly attributes A17 and denies new data collection.", fixture: { kind: "text", originId: "fictional-aster-a17" } },
      { title: "Fictional Cedar digest copy of A17", text: "FICTIONAL INTERNAL FIXTURE. Cedar digest: Based solely on the Beacon newsletter's account of Aster report A17, revised labels reduced median sorting time from eight to six minutes in twelve staff participants. This is a summary, not another experiment.", observedScope: "Frozen derivative explicitly traces through Beacon to A17.", fixture: { kind: "text", originId: "fictional-aster-a17" } },
    ],
    expectedArtifact: "Evidence-origin map and a count of independent reported experiments.",
    review: ["Count one reported experiment, not three independent studies.", "Preserve the Aster-to-Beacon-to-Cedar origin chain.", "Do not infer external replication or causal generalization from repeated publication."],
  },
  {
    id: "R13",
    inputKind: "synthetic",
    question: "Fictional PDF-reading exercise: compare the supplied text PDF and image-only PDF describing Selene cooling procedures. Which document's hold duration and cooling destination were actually extractable? Preserve read errors and identify a targeted recovery step. Do not infer a scanned document's claims from its title or the readable document.",
    targets: ["Text PDF hold duration and cooling destination", "Image-only PDF readable scope", "Unavailable comparison claims", "Targeted recovery without assuming OCR"],
    sources: [
      { title: "Fictional Selene text PDF", text: "FICTIONAL INTERNAL FIXTURE. Selene procedure A: Hold the sample for sixty seconds at the target temperature, then move it to the cooling tray. This is an invented procedure for document-reader evaluation, not scientific or safety guidance.", observedScope: "Expected text-layer fixture content; actual reader output must be captured separately.", fixture: { kind: "text-pdf", artifactPath: ".artifacts/workload-inputs/r13-text.pdf", originId: "fictional-selene-a" } },
      { title: "Fictional Selene image-only PDF", observedScope: "Image-only fixture with no text layer. Its hidden visual text must not be supplied as gathered evidence when extraction fails.", fixture: { kind: "image-only-pdf", artifactPath: ".artifacts/workload-inputs/r13-image-only.pdf", expectedReadError: "No extractable text layer; OCR is not assumed.", originId: "fictional-selene-b" } },
    ],
    expectedArtifact: "Read-scope and missing-evidence report.",
    review: ["Run the actual parser on generated PDF bytes before claiming parser coverage.", "Do not use expected fixture text as a substitute for an observed parser result.", "Extraction failure does not establish the scanned procedure is false or agrees with procedure A.", "Recommend obtaining accessible text or an explicitly available OCR/manual review, not invented automatic recovery."],
  },
  {
    id: "R14",
    inputKind: "synthetic",
    question: "Fictional version-change exercise: preserve the saved conclusion 'Aster API revision 1 permits a maximum batch of 100 records' and its revision-1 source. Compare it with the supplied revision-2 excerpt. Record the changed batch limit and unresolved support guarantee without rewriting the old evidence or suggesting any payment occurred.",
    targets: ["Saved revision-1 conclusion and source identity", "Revision-2 changed limit", "Truncated revision-2 support section", "Preservation and unresolved implications"],
    sources: [
      { title: "Fictional Aster API specification revision 1", text: "FICTIONAL INTERNAL FIXTURE. Aster API specification revision 1, dated 2026-08-01: Each batch may contain at most 100 records. The revision-1 saved conclusion cites this sentence. No payment receipt exists in this exercise.", observedScope: "Frozen original revision-1 excerpt; retain unchanged.", fixture: { kind: "versioned-text", version: "1", originId: "fictional-aster-api" } },
      { title: "Fictional Aster API specification revision 2 (truncated)", text: "FICTIONAL INTERNAL FIXTURE. Aster API specification revision 2, dated 2026-09-01: Each batch may contain at most 50 records. Compatibility with revision-1 clients is not described in this supplied excerpt. Support guarantee: [EXCERPT ENDS HERE; REMAINING TEXT NOT SUPPLIED]", observedScope: "Frozen revision-2 excerpt intentionally ends before the support guarantee; remaining document unavailable.", fixture: { kind: "versioned-text", version: "2", truncated: true, originId: "fictional-aster-api" } },
    ],
    expectedArtifact: "Before/after evidence note retaining original identity and missing implications.",
    review: ["Report 100 versus 50 with exact revision bindings.", "Do not rewrite the historical conclusion as though it originally cited revision 2.", "Do not complete the truncated support guarantee or infer client compatibility.", "No payment, receipt mutation or real API change occurred."],
  },
  {
    id: "R15",
    inputKind: "public-original",
    question: "Internal educational-content exercise: propose three English water-cycle video ideas for ages 6-8, each feasible as a three-minute narrated animation using simple shapes and one narrator. Support the science with the supplied NASA source, then label one proposed outline as a creative draft. Do not claim tested learning impact, trends, virality or audience demand.",
    targets: ["Water-cycle facts supported by the source", "Three distinct age-targeted creative ideas", "One proposed three-minute production outline", "Audience and production assumptions"],
    sources: [waterCycle],
    expectedArtifact: "Three fact-supported ideas plus one clearly proposed production outline.",
    review: ["Separate source facts from creative narration and assumed age suitability.", "Do not turn the source's general science explanation into measured learning outcomes.", "Useful creative synthesis is a distinct acceptance gate from quoting water-cycle facts."],
  },
  {
    id: "R16",
    inputKind: "public-original",
    question: "Fact-check this internally authored draft for ages 6-8; it is a deliberately imperfect example, not a customer script: 'The Sun warms puddles and water evaporates. Water vapor rises and cools. Clouds are bags that catch water. Rain can fall as snow or hail. Every raindrop returns to the ocean immediately, and water never goes underground.' Produce a claim table, supported corrections and unknowns; separate factual corrections from suggested child-friendly wording.",
    targets: ["Evaporation and cooling claims", "Cloud-bag metaphor and factual limits", "Forms of precipitation", "Immediate ocean return and groundwater claims"],
    sources: [waterCycle],
    expectedArtifact: "Claim table with supported corrections, unresolved claims and separate edits.",
    review: ["Treat the supplied draft as input under review, never as factual evidence.", "Distinguish rain, snow and hail instead of asserting they are the same form.", "Do not infer support for a cloud metaphor or scientific detail absent from the supplied source.", "Label draft wording as internally authored and corrections as evidence-bound."],
  },
  {
    id: "R17",
    inputKind: "repository",
    question: "Internal first-time integration task: build a server-side client that streams one Keryx research answer, retains query identity and citations, survives a disconnected stream and avoids accidentally duplicating sponsored work. Using only the supplied bounded excerpt from Keryx's public integration guide, identify unanswered integration questions and prioritize follow-up documentation. Distinguish 'not explained in this excerpt' from a missing product capability or omission across all docs. Do not call the API.",
    targets: ["Stream terminal metadata and retained identity", "Disconnect recovery and retry questions", "Authentication and shared allowance", "Prioritized excerpt-specific documentation gaps"],
    sources: [{
      title: "Keryx integration guide, selected opening bullets at 3c81ee981d9b06c315f0602fb874bd16cfc0ca88",
      text: "Repository excerpt from docs/openai-compatible-api.md, commit 3c81ee981d9b06c315f0602fb874bd16cfc0ca88.\n- Base URL: https://keryx.cc/api/v1\n- Auth: send any token as the API key. On the free tier the token is ignored (treasury-funded, IP rate-limited). Send a kx_live_ key for wallet-based limits + usage metering. All keys for one wallet share 10 sponsored calls/minute across chat and remote MCP; direct calls also share 10/minute per IP and the global sponsored allowance. Creating another key adds no quota.\n- Streaming: with stream: true, the agent's live buy/skip/trust reasoning arrives as delta.reasoning_content, then the answer as delta.content. The terminal chunk carries a keryx extension (queryId, citations, totalToCreators, dispatchUrl).\n- Budget (optional): pass a Keryx budget field (USDC, via extra_body) to cap creator payouts; it is clamped to the tier ceiling. Omit it for the default.\nMainnet sponsored research uses Keryx treasury funds within its reviewed caps. Caller-funded A2A is a separate x402 route; an API key holds no prepaid balance.",
      observedScope: "Author-selected and formatting-normalized opening bullets from a local public repository guide; not the full guide or current runtime schema. No private context or credentials included.",
    }],
    expectedArtifact: "Prioritized documentation-gap checklist for the supplied excerpt and explicit integration task.",
    review: ["State the snapshot's commit and bounded excerpt scope.", "Do not infer customer demand or absent functionality from an unanswered documentation question.", "Retained query ID and recovery semantics must not be guessed from dispatchUrl alone.", "No real request, funded research or customer integration was executed."],
  },
  {
    id: "R18",
    inputKind: "public-original",
    question: "Internally authored procurement example, not a customer purchasing instruction: a three-person team needs hosted PostgreSQL for a low-traffic internal knowledge app, with an assumed 3 GB database, 10 GB monthly egress, daily recoverable backups and a proposed USD 25 monthly ceiling. Compare Supabase Pro and Neon's entry paid offer using observed vendor pricing terms; retain the actual offer names and observation date. The app already has its own authentication. Explain integration work, unknown compute/backup costs and whether a choice is supportable. Do not invent missing prices or buy anything.",
    targets: ["Dated vendor offer and included limits", "Database, egress and backup fit", "Integration effort and unknown compute cost", "Budget fit or unresolved procurement decision"],
    sources: [
      { title: "Supabase pricing and fees", url: "https://supabase.com/pricing", observedScope: `${checked} Pricing page is mutable; execution must date its own observation and keep unknown total usage cost open.` },
      { title: "Neon pricing", url: "https://neon.com/pricing", observedScope: "Authoring browser returned an internal fetch error on 2026-10-04. No price, current offer name or included limit was observed. The execution may attempt this exact primary URL within its own allowance." },
    ],
    expectedArtifact: "Workflow-specific procurement brief with dated observed terms and open cost questions.",
    review: ["All workload and budget values are internal assumptions, not measured needs or authorized spending.", "Do not declare a total monthly price without the required usage and backup terms.", "A missing vendor page leaves that comparison unresolved; never fill it from invented terms.", "Compare the specified PostgreSQL workflow rather than generic feature rankings."],
  },
];
