import { describe, expect, it } from "vitest";
import { boundErrorMessage, MAX_ERROR_BYTES } from "./helper-protocol";
import { workspaceCreatedSelectionFailed } from "./helper-errors";

const longUnicodePath = "D:\\资料\\Keryx\\" + "研究报告-草稿-✓\\".repeat(200)
  + "Keryx-Operator-2026-09-29-abcd1234";

describe("helper error text", () => {
  it("keeps outcome and recovery instruction ahead of a long multi-byte path", () => {
    const error = workspaceCreatedSelectionFailed(longUnicodePath);
    expect(error.message).toContain(longUnicodePath);
    const bound = boundErrorMessage(error.message);
    expect(Buffer.byteLength(bound, "utf8")).toBeLessThanOrEqual(MAX_ERROR_BYTES);
    expect(bound).toContain("Workspace was created, but the selection could not be saved");
    expect(bound).toContain("Do not create a replacement yet");
    expect(bound).toContain("reopen the created folder");
    expect(bound.indexOf("Do not create a replacement")).toBeLessThan(bound.indexOf("D:\\"));
  });

  it("returns the complete message when it fits the wire bound", () => {
    const path = "D:\\work\\Keryx-Operator-2026-09-29-abcd1234";
    const error = workspaceCreatedSelectionFailed(path);
    expect(error.message.endsWith(path)).toBe(true);
    expect(boundErrorMessage(error.message)).toBe(error.message);
  });
});
