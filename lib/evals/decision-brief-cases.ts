/** Independently authored, frozen supplied-source inputs for the bounded-brief evaluation.
 * These are internal scenarios, not customer requests or measured workloads. Expected
 * answers, acceptance classes and prohibited inferences live in a separate ignored grader
 * artifact and must never be supplied to the reasoning engine. Captured document sections
 * likewise stay outside the public source tree pending redistribution review.
 */
export interface DecisionBriefCaseSource {
  captureId: string;
  url: string;
}

export interface DecisionBriefCase {
  id: string;
  question: string;
  subClaims: readonly string[];
  sources: readonly DecisionBriefCaseSource[];
}

export const DECISION_BRIEF_CASES_VERSION = "keryx-decision-brief-heldout-v1";
const node = "https://raw.githubusercontent.com/nodejs/node/v24.16.0/doc/api/";
const python = "https://raw.githubusercontent.com/python/cpython/v3.14.0/Doc/library/";
const docker = "https://raw.githubusercontent.com/docker/docs/main/content/manuals/engine/storage/";
const pg = "https://www.postgresql.org/docs/18/";

export const decisionBriefCases: readonly DecisionBriefCase[] = [
  {
    id: "DBH-01",
    question: "For a Node.js 24.16.0 service that parses JavaScript text and also performs network I/O, prepare a short decision brief on whether to introduce worker threads. Separate the two kinds of work, explain the worker-lifecycle tradeoff, and propose what to measure before adoption. No workload measurements have been supplied.",
    subClaims: [
      "Which kinds of work are suitable for worker threads versus the existing asynchronous I/O facilities?",
      "What documented worker-lifecycle and memory-sharing considerations affect the design?",
      "What conditional choice and measurement step follow from these facts without an invented performance result?",
    ],
    sources: [{ captureId: "node-workers", url: node + "worker_threads.md" }],
  },
  {
    id: "DBH-02",
    question: "A Node.js 24.16.0 Linux service must invoke a known executable with user-entered filenames as arguments; it does not need shell redirection or globbing. Give a brief choice between execFile and shell-enabled execution, with the relevant input-handling limits and a validation checklist. This is a design question, not permission to execute a command.",
    subClaims: [
      "How does execFile launch the executable and how does shell selection change that behavior?",
      "Which shell features and user-input hazards matter for this request?",
      "Which conditional invocation approach and checks are justified without promising that every argument is safe?",
    ],
    sources: [{ captureId: "node-execfile", url: node + "child_process.md" }],
  },
  {
    id: "DBH-03",
    question: "Several code paths in a Node.js 24.16.0 service want to update the same configuration file with fsPromises.writeFile. Prepare a coordination and failure-handling brief covering completion ordering, cancellation and the flush option. Do not assume an atomic replacement protocol exists outside the supplied API documentation.",
    subClaims: [
      "What completion ordering is required when issuing multiple writeFile calls for the same file?",
      "What do the documented cancellation and flush behaviors establish, and what do they leave unproven?",
      "What proposed coordination and verification steps follow for this configuration-file workflow?",
    ],
    sources: [{ captureId: "node-writefile", url: node + "fs.md" }],
  },
  {
    id: "DBH-04",
    question: "Plan adding an index to a live, non-partitioned PostgreSQL 18 table where writes need to continue. Compare a regular build with CREATE INDEX CONCURRENTLY and give a short operational decision with failure checks. No build-duration or load measurements are available.",
    subClaims: [
      "How do regular and concurrent index builds differ for writes, work and waiting?",
      "What transaction-block and simultaneous-build restrictions apply?",
      "What post-failure validity and uniqueness checks are needed before treating the index as ready?",
    ],
    sources: [{ captureId: "pg-index", url: pg + "sql-createindex.html" }],
  },
  {
    id: "DBH-05",
    question: "A PostgreSQL 18 import process uses savepoints and an already-open cursor. It may FETCH rows after creating a savepoint and then ROLLBACK TO that savepoint. Give a brief explaining which state is restored and a safe conditional plan for continuing the import.",
    subClaims: [
      "What happens to commands and savepoints when rolling back to a named savepoint?",
      "How do cursor position, cursor creation and a cursor that caused an abort behave across this rollback?",
      "What state checks or cursor-handling adjustments should the import plan make?",
    ],
    sources: [{ captureId: "pg-savepoint", url: pg + "sql-rollback-to.html" }],
  },
  {
    id: "DBH-06",
    question: "Design the retry decision for PostgreSQL 18 transactions that compute values from earlier reads. Compare handling SQLSTATE 40001, 40P01 and 23505, explain the retry unit, and give a bounded application-level plan without promising eventual success or assuming an automatic server retry.",
    subClaims: [
      "What distinctions does the documentation make among serialization, deadlock and unique-key failures?",
      "Which parts of the transaction and value-selection logic need to be retried?",
      "What limitations should a conditional application retry plan retain?",
    ],
    sources: [{ captureId: "pg-retry", url: pg + "mvcc-serialization-failure-handling.html" }],
  },
  {
    id: "DBH-07",
    question: "In Python 3.14.0, choose how to use asyncio.wait_for around a task when cancellation should be requested after five seconds but cleanup may take time. Explain what the caller can infer from the timeout, when shielding would change the choice, and what to verify. No cleanup-duration measurement is provided.",
    subClaims: [
      "What happens to the awaited task when wait_for times out or the wait is cancelled?",
      "What timing and exception behavior can the caller rely on during cancellation?",
      "When would shielding be an appropriate conditional alternative for the intended task lifetime?",
    ],
    sources: [{ captureId: "python-timeout", url: python + "asyncio-task.rst" }],
  },
  {
    id: "DBH-08",
    question: "A Python 3.14.0 program on Windows needs to reopen a NamedTemporaryFile by name using ordinary open while inside a with block, and wants cleanup when the context exits. Prepare a conditional configuration and cleanup checklist, including permission and handle-lifetime limitations.",
    subClaims: [
      "How do delete and delete_on_close determine the file's lifetime?",
      "Under which documented Windows conditions may the file be opened again by name?",
      "Which open-handle and delete-permission conditions must the cleanup plan check?",
    ],
    sources: [{ captureId: "python-tempfile", url: python + "tempfile.rst" }],
  },
  {
    id: "DBH-09",
    question: "A Python 3.14.0 service is shutting down its executor. The desired policy is to reject new submissions, discard work that has not started, and let already-running work finish. Give the shutdown option choice and explain caller-return versus interpreter-exit behavior; do not assume running tasks can be forcibly stopped.",
    subClaims: [
      "What happens to new submissions and to pending versus running futures after shutdown?",
      "How do wait and cancel_futures interact for the desired policy?",
      "What does an immediate shutdown return imply about program exit and remaining work?",
    ],
    sources: [{ captureId: "python-executor", url: python + "concurrent.futures.rst" }],
  },
  {
    id: "DBH-10",
    question: "Prepare a Docker bind-mount deployment brief for a container that only needs to read configuration files. The Docker daemon may be remote from the CLI machine. Explain the source-location decision, host write exposure and portability checks, without assuming the client's local path exists on the daemon host.",
    subClaims: [
      "Which machine supplies the filesystem path for a bind mount, including the remote-daemon case?",
      "What host filesystem access does a bind mount grant by default and how can writes be restricted?",
      "What host-layout and configuration-location checks should precede the deployment?",
    ],
    sources: [{ captureId: "docker-bind", url: docker + "bind-mounts.md" }],
  },
  {
    id: "DBH-11",
    question: "Choose a Docker volume approach for application data that should survive container replacement and be reused by a replacement container. Compare named and anonymous volumes, explain the --rm exception, and include the behavior when mounting an empty versus populated volume over image files.",
    subClaims: [
      "How does volume lifetime relate to container lifetime, including the --rm exception?",
      "How are named and anonymous volumes reused or shared across replacement containers?",
      "What happens to pre-existing image files under empty or non-empty mounted volumes?",
    ],
    sources: [{ captureId: "docker-volumes", url: docker + "volumes.md" }],
  },
  {
    id: "DBH-12",
    question: "For a Linux Docker container with temporary scratch data that need not survive a stop, prepare a conditional decision brief on tmpfs. Cover lifetime, container memory limits, sharing and the distinction between temporary storage and a guarantee that data never reaches disk. No host swap configuration has been supplied.",
    subClaims: [
      "What lifetime and sharing properties distinguish tmpfs for this scratch-data workload?",
      "How does tmpfs usage interact with the container's memory limit?",
      "What persistence qualification and host check belong in the conditional recommendation?",
    ],
    sources: [{ captureId: "docker-tmpfs", url: docker + "tmpfs.md" }],
  },
  {
    id: "DBH-13",
    question: "Can we approve a production commitment that introducing worker threads in our Node.js 24.16.0 endpoint will cut its latency by at least half? We have no profile, workload description or benchmark results beyond the supplied documentation. State what can be concluded and what decision evidence is missing.",
    subClaims: [
      "Does the supplied material establish the requested latency improvement for this endpoint?",
      "Which workload and measurement information is missing before making that commitment?",
    ],
    sources: [{ captureId: "node-workers", url: node + "worker_threads.md" }],
  },
  {
    id: "DBH-14",
    question: "We need a Windows NamedTemporaryFile recipe using delete_on_close that can be deployed unchanged, with no version branch, but the interpreter may be Python 3.11.0 or 3.14.0. Use both supplied versioned documents to decide whether that requirement is supported and identify the unresolved deployment input.",
    subClaims: [
      "What do the two exact document versions establish about the requested parameter and reopen behavior?",
      "Can the unchanged requested recipe be approved without identifying the deployed interpreter version?",
    ],
    sources: [
      { captureId: "python-tempfile-old", url: "https://raw.githubusercontent.com/python/cpython/v3.11.0/Doc/library/tempfile.rst" },
      { captureId: "python-tempfile", url: python + "tempfile.rst" },
    ],
  },
  {
    id: "DBH-15",
    question: "An operator says a PostgreSQL 18 CREATE UNIQUE INDEX CONCURRENTLY attempt failed, but supplies no error, catalog inspection or build phase. Can we declare that index ready for queries, or that it has stopped enforcing uniqueness, from the documentation alone? Give the decision status and the evidence needed before a recovery choice.",
    subClaims: [
      "Which index-validity and uniqueness outcomes are possible after a concurrent build failure?",
      "What actual deployment state is missing before approving readiness or a specific recovery operation?",
    ],
    sources: [{ captureId: "pg-index", url: pg + "sql-createindex.html" }],
  },
  {
    id: "DBH-16",
    question: "Can we certify that every submount of a read-only Docker bind mount is protected against writes when the Linux kernel version and inspected mount state have not been supplied? Give a conditional compatibility assessment and the checks needed before that guarantee.",
    subClaims: [
      "What kernel-version and bind-recursive behavior affects submount write protection?",
      "Which missing host and mount information prevents certifying the requested guarantee?",
    ],
    sources: [{ captureId: "docker-recursive", url: docker + "bind-mounts.md" }],
  },
];
