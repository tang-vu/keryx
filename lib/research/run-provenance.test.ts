import { describe, expect, it } from "vitest";
import { newRunProvenance, parseRunProvenance, recordedRunProvenance } from "./run-provenance";

const owner = `0x${"a".repeat(40)}`;
const provenance = { version: 1, surface: "api", ownershipMethod: "api-key" } as const;
describe("closed run provenance", () => {
  it("never creates an owner from an ingress label, client name or payment origin", () => {
    expect(newRunProvenance({ provenance })).toEqual({ ...provenance, ownershipMethod: "unknown" });
    const legacy = { asker: owner, origin: "web", mcpClient: "codex" };
    expect(newRunProvenance(legacy)).toEqual({ version: 1, surface: "unknown", ownershipMethod: "unknown" });
    expect(recordedRunProvenance(legacy)).toBe(legacy);
    expect(legacy).not.toHaveProperty("provenance");
  });
  it("snapshots existing verified ownership without retaining extra identities or invoking accessors", () => {
    const copy = newRunProvenance({ asker: owner, provenance });
    expect(copy).toEqual(provenance); expect(copy).not.toBe(provenance);
    const accessor = Object.defineProperty({ version: 1, surface: "api" }, "ownershipMethod", {
      enumerable: true, get: () => { throw Error("Private accessor must not run"); },
    });
    for (const value of [accessor, { ...provenance, wallet: owner }, { ...provenance, surface: "client-chosen" },
      { ...provenance, ownershipMethod: "claimed-later" }, { ...provenance, version: 2 }, null]) {
      expect(parseRunProvenance(value)).toBeUndefined();
    }
  });
});
