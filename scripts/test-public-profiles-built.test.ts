import { expect, it } from "vitest";
import { qualifyOwnedNextFixtureExit, type OwnedNextFixtureExit } from "../test-support/owned-next-fixture-exit";

const completed = (): OwnedNextFixtureExit => ({ pid: 123,
  exit: { code: 143, signal: null }, close: { code: 143, signal: null }, stdoutEof: true, stderrEof: true,
  stopRequest: { pid: 123, signal: "SIGTERM", sent: true, exitObservedBeforeRequest: false,
    closeObservedBeforeRequest: false, atUtc: "2026-10-13T00:00:00.000Z" } });

it("preserves complete natural zero exits without inventing a stop request", () => {
  const facts = completed(); facts.exit = facts.close = { code: 0, signal: null }; facts.stopRequest = null;
  expect(qualifyOwnedNextFixtureExit(facts)).toBe("zero-exit");
});
it("qualifies stock Next143/null only as an owned requested termination and preserves its raw facts", () => {
  const facts = completed(), before = structuredClone(facts);
  expect(qualifyOwnedNextFixtureExit(facts)).toBe("owned-requested-next-code143");
  expect(facts).toEqual(before); expect(facts.exit).toEqual({ code: 143, signal: null });
});
it("qualifies an actual reported SIGTERM only after the matching owned request", () => {
  const facts = completed(); facts.exit = facts.close = { code: null, signal: "SIGTERM" };
  expect(qualifyOwnedNextFixtureExit(facts)).toBe("owned-requested-sigterm");
});
it.each(["absent", "false", "foreign-pid", "after-exit", "after-close"] as const)("refuses143/null when its request is %s", defect => {
  const facts = completed();
  if (defect === "absent") facts.stopRequest = null;
  if (defect === "false") facts.stopRequest!.sent = false;
  if (defect === "foreign-pid") facts.stopRequest!.pid++;
  if (defect === "after-exit") facts.stopRequest!.exitObservedBeforeRequest = true;
  if (defect === "after-close") facts.stopRequest!.closeObservedBeforeRequest = true;
  expect(qualifyOwnedNextFixtureExit(facts)).toBeNull();
});
it.each(["exit", "close", "stdout", "stderr", "pid", "code-mismatch", "signal-mismatch"] as const)("refuses an incomplete or inconsistent lifetime: %s", defect => {
  const facts = completed();
  if (defect === "exit") facts.exit = null;
  if (defect === "close") facts.close = null;
  if (defect === "stdout") facts.stdoutEof = false;
  if (defect === "stderr") facts.stderrEof = false;
  if (defect === "pid") facts.pid = undefined;
  if (defect === "code-mismatch") facts.close!.code = 0;
  if (defect === "signal-mismatch") facts.close!.signal = "SIGTERM";
  expect(qualifyOwnedNextFixtureExit(facts)).toBeNull();
});
it.each([{ code: 1, signal: null }, { code: null, signal: "SIGKILL" }, { code: 143, signal: "SIGTERM" }] as const)("refuses every other failure tuple $code/$signal", result => {
  const facts = completed(); facts.exit = facts.close = result;
  expect(qualifyOwnedNextFixtureExit(facts)).toBeNull();
});
it("refuses an unrequested reported SIGTERM as well as an unrequested143", () => {
  const facts = completed(); facts.exit = facts.close = { code: null, signal: "SIGTERM" }; facts.stopRequest = null;
  expect(qualifyOwnedNextFixtureExit(facts)).toBeNull();
});
