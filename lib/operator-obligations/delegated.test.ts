import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeInspectionFixture, OBLIGATION_FIXTURE_OWNER as READER } from "../../test-support/operator-obligations";
const inspect = vi.hoisted(() => vi.fn());
vi.mock("./inspection", () => ({ inspectOperatorObligations: inspect }));
import { readDelegatedOperatorObligations } from "./delegated";

describe("hosted MCP delegation", () => {
  afterEach(() => { vi.unstubAllEnvs(); inspect.mockReset(); });
  it.each(["anonymous", "scope-only", "reader-only", "absent-config"])("refuses %s without private hydration", async mode => {
    if (mode !== "absent-config") { vi.stubEnv("KERYX_OPERATOR_OBLIGATION_READER", READER); vi.stubEnv("KERYX_OPERATOR_OBLIGATION_ROLE", "public"); }
    else { vi.stubEnv("KERYX_OPERATOR_OBLIGATION_READER", ""); vi.stubEnv("KERYX_OPERATOR_OBLIGATION_ROLE", ""); }
    await expect(readDelegatedOperatorObligations(mode === "anonymous" ? undefined : mode === "scope-only" ? `0x${"3".repeat(40)}` : READER,
      mode === "reader-only" ? ["profile:read", "history:read"] : ["operator:read"])).rejects.toThrow("refused or unavailable"); expect(inspect).not.toHaveBeenCalled();
  });
  it("withholds response on mid-inspection delegation revocation or wrong reader envelope", async () => {
    vi.stubEnv("KERYX_OPERATOR_OBLIGATION_READER", READER); vi.stubEnv("KERYX_OPERATOR_OBLIGATION_ROLE", "public");
    inspect.mockImplementationOnce(async () => { vi.stubEnv("KERYX_OPERATOR_OBLIGATION_READER", ""); return nativeInspectionFixture(); });
    await expect(readDelegatedOperatorObligations(READER, ["operator:read"])).rejects.toThrow("refused or unavailable");
    vi.stubEnv("KERYX_OPERATOR_OBLIGATION_READER", READER); inspect.mockResolvedValue({ ...nativeInspectionFixture(), readerWallet: `0x${"4".repeat(40)}` });
    await expect(readDelegatedOperatorObligations(READER, ["operator:read"])).rejects.toThrow("refused or unavailable");
  });
});
