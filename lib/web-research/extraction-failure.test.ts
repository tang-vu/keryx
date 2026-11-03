import { expect, it } from "vitest";
import { extractionFailureReasons, safeExtractionDiagnostic, rememberExtractionFailure, extractionFailure } from "./extraction-failure";

it.each(extractionFailureReasons)("retains only an observed closed stage, preserving exception identity: %s", reason => {
  const error = new Error("PRIVATE body https://host/private?token=SECRET C:\\PRIVATE\\worker.mjs");
  const before = Object.getOwnPropertyDescriptors(error), diagnostic = { format: "html" as const, reason };
  rememberExtractionFailure(error, diagnostic);
  expect(Object.getOwnPropertyDescriptors(error)).toEqual(before);
  expect(extractionFailure(error)).toEqual({ format: "html", reason });
  expect(JSON.stringify(extractionFailure(error))).not.toMatch(/PRIVATE|SECRET|host|worker\.mjs/);
  const copy = extractionFailure(error)!;copy.format = "pdf";
  expect(extractionFailure(error)?.format).toBe("html");
});
it.each([null, undefined, "deadline", 1, [], {}, { format: "html", reason: "heap-limit" },
  { format: "html", reason: "deadline", stderr: "PRIVATE" }, { format: "other", reason: "deadline" },
  Object.create({ format: "html", reason: "deadline" })])("refuses unknown or expanded diagnostic data: %j", value => {
  expect(safeExtractionDiagnostic(value)).toBeUndefined();
});
it("does not execute accessors/proxy traps or restore observation from JSON/error strings", () => {
  let accesses = 0;
  const value = Object.defineProperty({ format: "html" }, "reason", { get() { accesses++;throw new Error("PRIVATE"); } });
  expect(safeExtractionDiagnostic(value)).toBeUndefined();expect(accesses).toBe(0);
  expect(safeExtractionDiagnostic(new Proxy({}, { ownKeys() { throw new Error("PRIVATE"); } }))).toBeUndefined();
  const error = new Error("deadline");rememberExtractionFailure(error, { format: "pdf", reason: "deadline" });
  expect(extractionFailure(JSON.parse(JSON.stringify({ format: "pdf", reason: "deadline" })))).toBeUndefined();
  expect(extractionFailure(new Error("deadline"))).toBeUndefined();
  expect(extractionFailure(new Proxy({}, { get() { throw new Error("PRIVATE"); } }))).toBeUndefined();
});
