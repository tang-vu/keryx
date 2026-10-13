export interface OwnedNextFixtureExit {
  pid: number | undefined;
  exit: { code: number | null; signal: NodeJS.Signals | null } | null;
  close: { code: number | null; signal: NodeJS.Signals | null } | null;
  stdoutEof: boolean;
  stderrEof: boolean;
  stopRequest: {
    pid: number;
    signal: "SIGTERM";
    sent: boolean;
    exitObservedBeforeRequest: boolean;
    closeObservedBeforeRequest: boolean;
    atUtc: string;
  } | null;
}

/** Qualifies only this fixture's stock Next child; never discovers or signals a process.
 * Next's SIGTERM cleanup calls process.exit(143), so Node may report 143/null.
 * This is an owned requested termination, not a zero exit or signal acknowledgement. */
export function qualifyOwnedNextFixtureExit(facts: OwnedNextFixtureExit) {
  const { pid, exit, close, stopRequest } = facts;
  if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0 || !exit || !close ||
      !facts.stdoutEof || !facts.stderrEof || exit.code !== close.code || exit.signal !== close.signal) return null;
  if (exit.code === 0 && exit.signal === null) return "zero-exit";
  if (!stopRequest || stopRequest.pid !== pid || stopRequest.signal !== "SIGTERM" || !stopRequest.sent ||
      stopRequest.exitObservedBeforeRequest || stopRequest.closeObservedBeforeRequest) return null;
  if (exit.code === null && exit.signal === "SIGTERM") return "owned-requested-sigterm";
  if (exit.code === 143 && exit.signal === null) return "owned-requested-next-code143";
  return null;
}
