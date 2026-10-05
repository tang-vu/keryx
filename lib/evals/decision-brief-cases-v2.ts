/** Fresh internal decision cases, authored independently of v1 model outputs.
 * Frozen original-document sections and private acceptance criteria are retained
 * separately. These hypothetical engineering requests are not customer evidence.
 */
export interface DecisionBriefCaseV2 {
  id: string;
  question: string;
  subClaims: readonly string[];
  sources: readonly { captureId: string; url: string }[];
}

export const DECISION_BRIEF_CASES_VERSION = "keryx-decision-brief-heldout-v2";
const node = "https://raw.githubusercontent.com/nodejs/node/v24.16.0/doc/api/http.md";
const pg = "https://www.postgresql.org/docs/18/";
const git = "https://raw.githubusercontent.com/git/git/v2.51.0/Documentation/";
const compose = "https://raw.githubusercontent.com/compose-spec/compose-spec/6a1eb511ff670f55f2281416a4a8c3265efb6d36/05-services.md";

export const decisionBriefCases: readonly DecisionBriefCaseV2[] = [
  {
    id: "DBV2-01",
    question: "Prepare a shutdown decision brief for an internal Node.js 24.16.0 HTTP service. It should stop admitting connections, allow normal requests to finish where possible, and separately account for WebSocket connections. Compare close, closeIdleConnections and closeAllConnections, including the order of calls if forceful closure is chosen. This is a design request, not permission to stop a service.",
    subClaims: ["What does close do for new, idle and active HTTP connections in this version?", "How do the idle-only and forceful closure methods differ, including upgraded sockets?", "What shutdown ordering and explicit remaining connection checks follow for this service?"],
    sources: [{ captureId: "v2-node-shutdown", url: node }],
  },
  {
    id: "DBV2-02",
    question: "An internal Node.js 24.16.0 HTTP server needs separate policies for clients taking too long to send a request and for inactive sockets. Prepare a configuration review comparing requestTimeout, setTimeout and timeout. Explain what a custom timeout listener must account for and whether changing timeout updates existing connections. Do not invent deployment-specific timeout values.",
    subClaims: ["Which documented setting bounds receipt of the entire request, and what happens at expiry?", "How do socket inactivity defaults and custom timeout callbacks differ from that request-receipt deadline?", "What existing-connection and handler checks should accompany a policy change?"],
    sources: [{ captureId: "v2-node-timeouts", url: node }],
  },
  {
    id: "DBV2-03",
    question: "An internal upload endpoint in Node.js 24.16.0 wants to decide whether a client should send its body when Expect is present. Give a brief for implementing checkContinue and distinguishing other Expect values. Include the default responses and the routing consequence for the ordinary request listener, without assuming an authentication policy not supplied here.",
    subClaims: ["How is Expect: 100-continue handled by default and by a checkContinue listener?", "What differs for other Expect header values and their default response?", "How should request routing and the accept-or-reject decision be checked when these events are handled?"],
    sources: [{ captureId: "v2-node-expect", url: node }],
  },
  {
    id: "DBV2-04",
    question: "Using the frozen PostgreSQL 18 constraint documentation, review a schema plan that requires a present, positive price and is also considering a CHECK whose result depends on another row. Explain which constraints the local value needs and whether the cross-row CHECK is a reliable continuously maintained rule. Give a concrete conditional revision plan, not a claim about any deployed database.",
    subClaims: ["How does a CHECK treat null results, and what separately prevents a null column value?", "What limitation applies to CHECK conditions depending on other rows or mutable behavior?", "What constraint choices and validation checks follow for this proposed schema?"],
    sources: [{ captureId: "v2-pg-check-null", url: pg + "ddl-constraints.html" }],
  },
  {
    id: "DBV2-05",
    question: "Plan a staged foreign-key rollout on a large PostgreSQL 18 table using NOT VALID and later VALIDATE CONSTRAINT, based on the frozen supplied documentation. Explain what each phase checks, the impact on existing versus subsequent writes, and the validation locking qualification. Existing violations may be present; no row audit or execution result is supplied.",
    subClaims: ["What work and enforcement change when the new constraint is first added NOT VALID?", "What does later validation check, and what locking does the documentation describe?", "What sequence and readiness checks follow if pre-existing violations may need correction?"],
    sources: [{ captureId: "v2-pg-not-valid", url: pg + "sql-altertable.html" }],
  },
  {
    id: "DBV2-06",
    question: "A PostgreSQL 18 import transaction uses deferrable foreign keys and wants an explicit integrity checkpoint before later application work. Explain changing SET CONSTRAINTS from DEFERRED to IMMEDIATE, including failure behavior, and compare this with NOT NULL and CHECK constraints. Give a brief conditional plan that stays inside the current transaction.",
    subClaims: ["Which constraint modes can SET CONSTRAINTS change and when are deferred checks performed?", "What happens to outstanding modifications and mode changes when an immediate checkpoint fails?", "Which constraint kinds and transaction-scope limits must the import plan retain?"],
    sources: [{ captureId: "v2-pg-set-constraints", url: pg + "sql-set-constraints.html" }],
  },
  {
    id: "DBV2-07",
    question: "For Git 2.51.0, prepare a file-recovery decision brief distinguishing unstaging a path while keeping working-tree edits from restoring both the index and working tree to a chosen commit. Explain the default restore sources, location flags and the missing-path consequence. Do not execute anything or assume the user wants to discard local edits.",
    subClaims: ["Which locations do staged and worktree flags affect, individually and together?", "How is the restore source selected by default or with an explicit source?", "Which recovery choice and missing-path check preserve the stated intent about local edits?"],
    sources: [{ captureId: "v2-git-restore", url: git + "git-restore.adoc" }],
  },
  {
    id: "DBV2-08",
    question: "A team using Git 2.51.0 wants to undo a faulty merge through new history rather than rewriting shared history. Prepare a revert decision brief covering the working-tree precondition, selection of the merge mainline parent and the effect on later merges. No commit graph or intended parent has been supplied, and this is not permission to run a command.",
    subClaims: ["What does revert record and what working-tree condition does the supplied description require?", "Why must a merge mainline parent be chosen and how is that parent identified?", "What future-merge consequence and graph review should precede this operation?"],
    sources: [{ captureId: "v2-git-revert", url: git + "git-revert.adoc" }],
  },
  {
    id: "DBV2-09",
    question: "For a reviewed history rewrite in Git 2.51.0, a team can record the intended remote ref and its reviewed current object ID before proposing a push. Compare explicit force-with-lease expectations with the implicit remote-tracking forms, especially when an editor fetches in the background. Give the guarded proposal and the mismatch outcome without executing a push or inventing an object ID.",
    subClaims: ["What expected-value condition does force-with-lease impose on the remote ref?", "How do explicit and remote-tracking expectations differ under background fetches?", "What explicit ref and reviewed-value checks should gate the proposed rewrite?"],
    sources: [{ captureId: "v2-git-lease", url: git + "git-push.adoc" }],
  },
  {
    id: "DBV2-10",
    question: "Using the supplied commit-pinned Compose specification, plan startup dependencies for a web service that needs a healthy database and a successful one-shot initialization job. Compare the three long-form dependency conditions and explain what depends_on restart: true does during Compose-controlled versus runtime-controlled restarts. Give configuration decisions and verification steps without claiming ongoing application readiness is guaranteed.",
    subClaims: ["How do service_started, service_healthy and service_completed_successfully differ?", "What restarts are included and excluded by depends_on restart: true?", "What dependency conditions and lifecycle checks fit the stated web-service startup requirements?"],
    sources: [{ captureId: "v2-compose-dependencies", url: compose }],
  },
  {
    id: "DBV2-11",
    question: "Review a Compose healthcheck proposal that uses a shell expression containing ||, while another service only needs a direct executable and argument list. From the supplied specification, choose the test forms, explain Dockerfile overrides and intentional disabling, and identify the version consideration for start_interval. No actual health result is supplied.",
    subClaims: ["How do a string, CMD and CMD-SHELL select healthcheck command execution?", "How may Compose override or explicitly disable the image's healthcheck?", "Which form and version checks follow for the two proposed checks without certifying service health?"],
    sources: [{ captureId: "v2-compose-healthcheck", url: compose }],
  },
  {
    id: "DBV2-12",
    question: "Prepare a Compose stop-policy brief for a service whose owner wants a configurable termination signal and a bounded opportunity to exit before forceful termination. Use the supplied specification to explain stop_signal and stop_grace_period defaults and interaction. Recommend what to configure and observe, without claiming the application will finish cleanup within that period.",
    subClaims: ["Which signal is used by default and how can it be changed?", "What interval and subsequent signal does stop_grace_period control, including its default?", "What conditional stop-policy configuration and application-exit checks follow?"],
    sources: [{ captureId: "v2-compose-stop", url: compose }],
  },
  {
    id: "DBV2-13",
    question: "Can we approve a guarantee that invoking closeAllConnections on a Node.js 24.16.0 service will finish every active operation and close every WebSocket within five seconds? The only supplied evidence is the shutdown API documentation; no application cleanup behavior, socket inventory or timing measurements are available. State the decision and what evidence is still needed.",
    subClaims: ["Does this API's documented scope establish graceful completion and closure of upgraded sockets?", "Does the supplied evidence establish the proposed five-second guarantee, and what must be checked before approval?"],
    sources: [{ captureId: "v2-node-shutdown", url: node }],
  },
  {
    id: "DBV2-14",
    question: "An internal migration note says a PostgreSQL 18 foreign key was added with NOT VALID. No existing-row audit or successful validation result is supplied. Can we now certify that every historical row satisfies the relationship and mark the migration complete? Explain the distinction between subsequent-write enforcement and evidence for historical rows.",
    subClaims: ["What does adding the constraint NOT VALID establish for subsequent changes versus pre-existing rows?", "What evidence is missing before certifying historical integrity and completed validation?"],
    sources: [{ captureId: "v2-pg-not-valid", url: pg + "sql-altertable.html" }],
  },
  {
    id: "DBV2-15",
    question: "An editor fetches from origin in the background, and a teammate claims that bare --force-with-lease is therefore enough to certify that a planned Git 2.51.0 push cannot overwrite any unseen work. We have no reviewed expected remote object ID, graph inspection or collaboration approval. Can that claim be approved from the supplied documentation? Give the decision and missing inputs, without issuing a push command.",
    subClaims: ["What documented assumption does the implicit lease make about remote-tracking information?", "Does background fetching preserve the claimed protection, and what reviewed expectation is missing?"],
    sources: [{ captureId: "v2-git-lease", url: git + "git-push.adoc" }],
  },
  {
    id: "DBV2-16",
    question: "A proposed Compose runbook says depends_on with service_healthy and restart: true proves that a web service will automatically recover whenever its database crashes and is restarted by the container runtime. The application retry behavior and incident observations are unknown. Can that operational guarantee be approved using only the supplied specification? Explain the scope mismatch and remaining evidence.",
    subClaims: ["What startup and explicit-restart behaviors does the declared dependency actually establish?", "Does it establish recovery after runtime-driven database restarts, and what additional behavior remains unverified?"],
    sources: [{ captureId: "v2-compose-dependencies", url: compose }],
  },
];
