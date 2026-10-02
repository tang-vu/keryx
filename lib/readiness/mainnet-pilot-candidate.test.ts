import { describe, expect, it } from "vitest";
import { inspectMainnetPilotCandidate, type MainnetPilotCandidate } from "./mainnet-pilot-candidate";
import { candidate } from "./mainnet-pilot-candidate-fixture";

describe("isolated invited mainnet candidate", () => {
  it("accepts a bounded proposal without declaring signing, launch or settlement authority", () => {
    const result = inspectMainnetPilotCandidate(candidate());
    expect(result).toMatchObject({ candidateAccepted: true, mainnetReady: false, launchAuthorized: false,
      currentRuntimeSupported: false, reasons: [], candidateDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.scope?.excludedSpendSurfaces).toContain("treasury");
    expect(result.scope?.excludedSpendSurfaces).toContain("caller_cli");
    expect(result.scope?.allowedFutureSurfaces).toEqual(["web_browser"]);
    expect("remainingGates" in result && result.remainingGates).toContain("durable_global_pilot_admission");
  });
  it.each([
    ["origin_not_isolated", (c: MainnetPilotCandidate) => { c.mainnetOrigin = c.testnetOrigin; }],
    ["state_or_environment_not_isolated", (c: MainnetPilotCandidate) => { c.mainnetStateRoot = "d:/RETAINED/testnet/child"; }],
    ["state_or_environment_not_isolated", (c: MainnetPilotCandidate) => { c.mainnetEnvironmentFile = c.testnetEnvironmentFile; }],
    ["state_or_environment_not_isolated", (c: MainnetPilotCandidate) => { c.mainnetEnvironmentFile = "D:/retained/testnet/.env.pilot"; }],
    ["testnet_identity_reused", (c: MainnetPilotCandidate) => { c.invitedBuyerAddresses = c.retainedTestnetSignerAddresses; }],
    ["testnet_identity_reused", (c: MainnetPilotCandidate) => { c.creatorPayoutAddresses = c.retainedTestnetSignerAddresses; }],
    ["duplicate_role_address", (c: MainnetPilotCandidate) => { c.invitedBuyerAddresses.push(c.invitedBuyerAddresses[0]); }],
    ["pilot_limit_refused", (c: MainnetPilotCandidate) => { c.limits.totalMicroUsdc = "1000001"; }],
    ["pilot_limit_refused", (c: MainnetPilotCandidate) => { c.limits.perPaymentMicroUsdc = "10001"; }],
    ["pilot_limit_refused", (c: MainnetPilotCandidate) => { c.limits.perBuyerMicroUsdc = "250001"; }],
    ["pilot_limit_refused", (c: MainnetPilotCandidate) => { c.limits.perAskMicroUsdc = "50001"; }],
    ["pilot_limit_refused", (c: MainnetPilotCandidate) => { c.limits.perAskMicroUsdc = "1"; }],
    ["pilot_limit_refused", (c: MainnetPilotCandidate) => { c.limits.perBuyerMicroUsdc = "1"; }],
    ["pilot_limit_refused", (c: MainnetPilotCandidate) => { c.limits.totalMicroUsdc = "1"; }],
  ])("refuses %s", (reason, change) => {
    const c = candidate(); change(c);
    const result = inspectMainnetPilotCandidate(c);
    expect(result.candidateAccepted).toBe(false); expect(result.reasons).toContain(reason);
  });
  it.each(["0", "-1", "1.1", "1e6", "00001", "1000000000000000000000000000", 10000])("refuses noncanonical integer amounts %s", amount => {
    expect(inspectMainnetPilotCandidate({ ...candidate(), limits: { ...candidate().limits, perPaymentMicroUsdc: amount } }).reasons)
      .toEqual(["candidate_schema_refused"]);
  });
  it.each([
    { privateKey: "private-secret-never-output" }, { mainnetStateRoot: "D:/retained/../mainnet" },
    { mainnetStateRoot: "relative-path" }, { mainnetOrigin: "https://user:secret@example.com" },
    { rpcUrl: "https://untrusted.example.com" }, { releaseCommit: "main" },
    { invitedBuyerAddresses: [`0x${"00".repeat(20)}`] }, { supportOwner: "secret\noperator" },
  ])("refuses unknown, private or malformed input without echoing it", patch => {
    const result = inspectMainnetPilotCandidate({ ...candidate(), ...patch });
    expect(result.reasons).toEqual(["candidate_schema_refused"]);
    expect(JSON.stringify(result)).not.toContain("private-secret");
  });
  it("binds exact release, budgets and roles into the review digest", () => {
    const a = inspectMainnetPilotCandidate(candidate());
    const b = inspectMainnetPilotCandidate({ ...candidate(), releaseCommit: "b".repeat(40) });
    expect("candidateDigest" in a && a.candidateDigest).not.toBe("candidateDigest" in b && b.candidateDigest);
    const reversed = Object.fromEntries(Object.entries(candidate()).reverse());
    expect(inspectMainnetPilotCandidate(reversed)).toEqual(a);
  });
  it("allows owner-operated self-funded roles while labeling their overlap honestly", () => {
    const c = candidate(); c.creatorPayoutAddresses = c.invitedBuyerAddresses;
    const result = inspectMainnetPilotCandidate(c);
    expect(result.candidateAccepted).toBe(true); expect(result.scope?.selfFundedBuyerCreatorCount).toBe(1);
  });
  it("rejects nested Unix roots and allows separate sibling directories", () => {
    const c = { ...candidate(), mainnetStateRoot: "/srv/keryx-mainnet", testnetStateRoot: "/srv/keryx-testnet",
      mainnetEnvironmentFile: "/etc/keryx/mainnet.env", testnetEnvironmentFile: "/etc/keryx/testnet.env" };
    expect(inspectMainnetPilotCandidate(c).candidateAccepted).toBe(true);
    expect(inspectMainnetPilotCandidate({ ...c, testnetStateRoot: "/srv/keryx-mainnet/old" }).candidateAccepted).toBe(false);
  });
});
