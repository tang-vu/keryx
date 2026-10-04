/** Final fresh internal supplied-document decision cases. These are hypothetical
 * engineering requests, not customer demand. Original sections and independent
 * grading criteria are retained separately; criteria are never model input.
 */
export interface DecisionBriefCaseV3 {
  id: string;
  question: string;
  subClaims: readonly string[];
  sources: readonly { captureId: string; url: string }[];
}

export const DECISION_BRIEF_CASES_VERSION = "keryx-decision-brief-heldout-v3";
const node = "https://raw.githubusercontent.com/nodejs/node/v24.16.0/doc/api/timers.md";
const python = "https://raw.githubusercontent.com/python/cpython/v3.14.0/Doc/library/queue.rst";
const git = "https://raw.githubusercontent.com/git/git/v2.51.0/Documentation/";
const rust = "https://doc.rust-lang.org/1.90.0/std/fs/";

export const decisionBriefCases: readonly DecisionBriefCaseV3[] = [
  {
    id: "DBV3-01",
    question: "Review a Node.js 24.16.0 retry scheduler that accepts a numeric delay and passes it to setTimeout. Give a short decision brief on delay validation and what timing promise the service can honestly make. Cover out-of-range and fractional inputs, then propose a concrete validation or observation step without inventing a workload-specific delay.",
    subClaims: ["How are unusual numeric delay inputs treated by setTimeout?", "What timing or ordering guarantees are absent, and what validation and observation policy follows?"],
    sources: [{ captureId: "v3-node-delay", url: node }],
  },
  {
    id: "DBV3-02",
    question: "A Node.js 24.16.0 command-line tool schedules best-effort bookkeeping with setImmediate. It should be allowed to exit if that callback is the only remaining activity, while a separate user choice may cancel it entirely. Explain the appropriate Immediate lifecycle choices and how the maintainer should verify them; do not promise that best-effort bookkeeping always runs.",
    subClaims: ["How do ref and unref affect whether an Immediate keeps the event loop alive?", "How does cancellation differ from unref, and what exit/callback behavior should be verified?"],
    sources: [{ captureId: "v3-node-immediate", url: node }],
  },
  {
    id: "DBV3-03",
    question: "An internal Node.js 24.16.0 inactivity monitor wants to reuse an existing Timeout object each time activity occurs instead of allocating another timer. Prepare a decision brief using refresh, including what happens to the duration and to a timer whose callback already ran. Give the lifecycle check needed before adopting this pattern.",
    subClaims: ["What does refresh reset and reuse, and which duration does it retain?", "What happens after the callback has already fired, and what conditional lifecycle check follows?"],
    sources: [{ captureId: "v3-node-refresh", url: node }],
  },
  {
    id: "DBV3-04",
    question: "A threaded producer using Python 3.14.0 queue.Queue must attempt to enqueue work without waiting for a free slot. Its proposed implementation checks qsize or full first and then calls ordinary put. Give a better documented choice and the outcomes it must handle, including a shut-down queue. Do not assume a preliminary size observation reserves capacity.",
    subClaims: ["What do qsize, empty and full establish about whether the following queue operation will block?", "Which non-waiting producer operation and exception handling fit the requirement?"],
    sources: [{ captureId: "v3-python-producer", url: python }],
  },
  {
    id: "DBV3-05",
    question: "For a Python 3.14.0 queue.Queue worker pool, explain how to use task_done and join as an application completion checkpoint. Distinguish getting an item from marking its work complete, include the over-reporting error and immediate-shutdown caveat, and propose an accounting check before relying on join.",
    subClaims: ["How do unfinished-task counts, task_done and join relate to fetched and completed work?", "What over-reporting and immediate-shutdown qualifications must the completion-check design preserve?"],
    sources: [{ captureId: "v3-python-tracking", url: python }],
  },
  {
    id: "DBV3-06",
    question: "Choose a Python 3.14.0 queue.Queue shutdown mode for a service that wants to stop new interaction while allowing already-enqueued work to be retrieved where possible. Compare default shutdown with immediate shutdown, including blocked callers and join implications. Give a conditional mode choice and what completion evidence the service should retain.",
    subClaims: ["How do default and immediate shutdown differ for subsequent get calls and blocked callers?", "How can immediate shutdown affect task accounting, and what mode and completion checks follow?"],
    sources: [{ captureId: "v3-python-shutdown", url: python }],
  },
  {
    id: "DBV3-07",
    question: "A developer using Git 2.51.0 has local edits and wants to create and switch to a new branch without deliberately discarding those edits. Explain the documented switch precondition and the transactional behavior of switch --create if switching cannot complete. Give the checks and conditional approach before attempting it; no repository command is authorized here.",
    subClaims: ["When does ordinary switch allow local differences and when does it abort?", "How does create-and-switch behave on failure, and what branch/start-point checks follow?"],
    sources: [{ captureId: "v3-git-switch", url: git + "git-switch.adoc" }],
  },
  {
    id: "DBV3-08",
    question: "In Git 2.51.0, a developer wants to restore stashed work while retaining the stash until the result has been checked. Compare apply with pop, explain the documented conflict behavior and working-directory precondition, and give a conditional recovery plan. Do not execute a restore or assume that applying the stash succeeds.",
    subClaims: ["How do apply and pop differ in retaining the stash entry and what precondition is stated?", "What happens when application conflicts, and what check should precede removing a retained stash?"],
    sources: [{ captureId: "v3-git-stash", url: git + "git-stash.adoc" }],
  },
  {
    id: "DBV3-09",
    question: "Prepare a Git 2.51.0 workspace-cleanup review that starts with showing which untracked paths would be affected, without deleting anything yet. Explain dry-run versus interactive cleaning, path and directory scope, and the extra protection for nested Git repositories. Recommend a review sequence, not an immediate deletion command.",
    subClaims: ["How do pathspec, directory traversal and nested-repository protection limit cleanup scope?", "Which preview or interactive mode fits the stated intent and what should be reviewed before deletion?"],
    sources: [{ captureId: "v3-git-clean", url: git + "git-clean.adoc" }],
  },
  {
    id: "DBV3-10",
    question: "A Rust 1.90.0 application wants to rename an existing file or directory onto a chosen destination across supported Unix and Windows hosts. Give a feasibility brief covering replacement, mount boundaries, destination-type differences and relevant failure checks. No filesystem layout or platform build has been supplied, so make the plan conditional.",
    subClaims: ["Which mount, existing-destination and platform rules govern fs::rename?", "What source, destination and permission checks are needed before relying on the operation?"],
    sources: [{ captureId: "v3-rust-rename", url: rust + "fn.rename.html" }],
  },
  {
    id: "DBV3-11",
    question: "Review using Rust 1.90.0 fs::create_dir_all to prepare a nested application directory while more than one process may start at once. Explain its behavior on partial failure, concurrent creation and an empty path. Give a conditional initialization and failure-inspection plan without treating it as a filesystem transaction.",
    subClaims: ["What atomicity and partial-state behavior applies when recursive directory creation fails?", "What do concurrent self-races and an empty path imply for initialization validation and error handling?"],
    sources: [{ captureId: "v3-rust-directories", url: rust + "fn.create_dir_all.html" }],
  },
  {
    id: "DBV3-12",
    question: "A Rust 1.90.0 program wants to observe synchronization errors after writing a file instead of relying only on dropping its File handle. Compare sync_all and sync_data for content versus metadata requirements, including the portability and cost qualifications. Give a conditional API choice and error-handling step without inventing a crash-survival guarantee.",
    subClaims: ["How does explicit synchronization differ from dropping File for completion and error visibility?", "How do sync_all and sync_data differ, and what conditional choice and portability check follow?"],
    sources: [{ captureId: "v3-rust-sync", url: rust + "struct.File.html" }],
  },
  {
    id: "DBV3-13",
    question: "Can a Node.js 24.16.0 service promise that every setTimeout callback runs exactly 100 milliseconds after scheduling and that callbacks always run in submission order? The only evidence supplied is the API section, with no workload or timing measurements. Decide whether that promise is justified and state the missing validation rather than inventing results.",
    subClaims: ["Does the API establish exact callback timing and ordering?", "What decision and measurement limitation follows for the requested production promise?"],
    sources: [{ captureId: "v3-node-delay", url: node }],
  },
  {
    id: "DBV3-14",
    question: "A Python 3.14.0 service called Queue.shutdown(immediate=True), then observed join return. No per-job completion records are available. Can the service certify that every queued job actually ran to completion from those observations alone? Explain the accounting distinction and evidence needed before certifying completed work.",
    subClaims: ["What does immediate shutdown do to the remaining queue task count and waiting join callers?", "Does join returning prove actual job execution here, and what independent completion evidence is missing?"],
    sources: [{ captureId: "v3-python-shutdown", url: python }],
  },
  {
    id: "DBV3-15",
    question: "A Git 2.51.0 stash pop reported conflicts. A teammate assumes the stash entry must now be gone and the working tree must contain a fully resolved restoration, so asks to discard the extra backup. We have no current status or conflict-resolution evidence. Can those assumptions and backup disposal be approved from the supplied subcommand documentation? Give the decision and required checks, without changing files.",
    subClaims: ["What does the documented pop conflict path say about the stash entry and manual resolution?", "What repository-state evidence is missing before declaring restoration complete or discarding a backup?"],
    sources: [{ captureId: "v3-git-stash", url: git + "git-stash.adoc" }],
  },
  {
    id: "DBV3-16",
    question: "A deployment proposal claims Rust 1.90.0 fs::rename is a universally successful move-and-replace procedure even when the destination may be on another mount and its existing type is unknown. No host, permissions or filesystem inventory is available. Can that portability guarantee be approved from the supplied documentation? Explain the decisive limits and missing checks.",
    subClaims: ["Which documented rename restrictions contradict or limit the proposed universal move-and-replace guarantee?", "What host and source/destination evidence is missing before approving this deployment procedure?"],
    sources: [{ captureId: "v3-rust-rename", url: rust + "fn.rename.html" }],
  },
];
