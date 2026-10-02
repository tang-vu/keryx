import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { createPilotGrantMessage, parsePublicMainnetEnrollment, publicMainnetEnrollmentDigest,
  verifyPublicMainnetEnrollment } from "./public-enrollment";

const OWNER = privateKeyToAccount(`0x${"11".repeat(32)}`);
const SIGNER = privateKeyToAccount(`0x${"22".repeat(32)}`);
const fixture = () => ({ format: "keryx-mainnet-enrollment-v1" as const,
  candidateDigest: "77".repeat(32), releaseCommit: "88".repeat(20), origin: "https://pilot.example.invalid",
  network: ARC_MAINNET_PROFILE, registryAddress: `0x${"55".repeat(20)}`, invitedBuyers: [OWNER.address.toLowerCase()],
  retainedTestnetSigners: [`0x${"44".repeat(20)}`], approvedSourceIds: [`0x${"66".repeat(32)}`],
  approvedCreatorAddresses: [`0x${"33".repeat(20)}`], approvedPayoutAddresses: [`0x${"99".repeat(20)}`],
  limits: { totalMicros: 1_000_000, perBuyerMicros: 250_000, perAskMicros: 50_000, perPaymentMicros: 10_000, maxAsks: 20 },
  epoch: "mainnet-pilot", expiresAtSeconds: 2_000_003_600 });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("complete reviewed browser enrollment", () => {
  it("hashes the full canonical artifact identically in WebCrypto and Node", async () => {
    const input = fixture(), parsed = parsePublicMainnetEnrollment(input);
    expect(await publicMainnetEnrollmentDigest(input)).toBe(createHash("sha256").update(canonicalJson(parsed)).digest("hex"));
    expect(parsed.network).toBe(ARC_MAINNET_PROFILE);
    expect(Object.isFrozen(parsed)).toBe(true); expect(Object.isFrozen(parsed.limits)).toBe(true);
    expect(Object.isFrozen(parsed.approvedSourceIds)).toBe(true);
  });

  it("authenticates each reviewed field rather than the draft candidate label alone", async () => {
    const input = fixture(), expected = await publicMainnetEnrollmentDigest(input);
    const changes = [
      { releaseCommit: "aa".repeat(20) }, { candidateDigest: "bb".repeat(32) },
      { origin: "https://other.example.invalid" }, { registryAddress: `0x${"aa".repeat(20)}` },
      { approvedSourceIds: [`0x${"aa".repeat(32)}`] }, { approvedCreatorAddresses: [`0x${"bb".repeat(20)}`] },
      { approvedPayoutAddresses: [`0x${"cc".repeat(20)}`] }, { invitedBuyers: [SIGNER.address.toLowerCase()] },
      { retainedTestnetSigners: [`0x${"dd".repeat(20)}`] }, { epoch: "next-pilot" }, { expiresAtSeconds: input.expiresAtSeconds + 1 },
      ...Object.keys(input.limits).map(key => ({ limits: { ...input.limits, [key]: input.limits[key as keyof typeof input.limits] - 1 } })),
    ];
    for (const change of changes) await expect(verifyPublicMainnetEnrollment({ ...input, ...change }, expected,
      change.origin ?? input.origin)).rejects.toThrow();
    expect((await verifyPublicMainnetEnrollment(input, expected, input.origin)).enrollmentDigest).toBe(expected);
  });

  it("refuses mixed network pins, oversized scopes, duplicate or reused testnet participants", () => {
    const input = fixture();
    for (const network of [ARC_TESTNET_PROFILE, { ...ARC_MAINNET_PROFILE, rpcUrl: "https://foreign.invalid" },
      { ...ARC_MAINNET_PROFILE, gatewayWallet: ARC_TESTNET_PROFILE.gatewayWallet },
      { ...ARC_MAINNET_PROFILE, erc20Decimals: 18 }]) expect(() => parsePublicMainnetEnrollment({ ...input, network })).toThrow();
    expect(() => parsePublicMainnetEnrollment({ ...input, approvedSourceIds: [] })).toThrow();
    expect(() => parsePublicMainnetEnrollment({ ...input, invitedBuyers: [input.invitedBuyers[0], input.invitedBuyers[0]] })).toThrow();
    expect(() => parsePublicMainnetEnrollment({ ...input, retainedTestnetSigners: input.invitedBuyers })).toThrow("isolation");
    expect(() => parsePublicMainnetEnrollment({ ...input, limits: { ...input.limits, perPaymentMicros: 10001 } })).toThrow();
    expect(() => parsePublicMainnetEnrollment({ ...input, limits: { ...input.limits, perAskMicros: 2000 } })).toThrow();
    expect(() => parsePublicMainnetEnrollment({ ...input, extraAuthority: true })).toThrow();
  });

  it("binds separate owner delegation to the exact enrollment/session/cap/epoch/expiry", async () => {
    const input = fixture(), expected = await publicMainnetEnrollmentDigest(input);
    const verified = await verifyPublicMainnetEnrollment(input, expected, input.origin);
    const fields = { owner: OWNER.address.toLowerCase(), signer: SIGNER.address.toLowerCase(), grantEpoch: "grant-1",
      capMicroUsdc: "250000", expirySeconds: String(input.expiresAtSeconds) };
    const message = createPilotGrantMessage(verified, fields);
    const signature = await OWNER.signMessage({ message });
    expect((await recoverMessageAddress({ message, signature })).toLowerCase()).toBe(fields.owner);
    expect(message).toContain(`Enrollment: ${expected}`); expect(message).not.toContain(`Enrollment: ${input.candidateDigest}`);
    for (const change of [{ grantEpoch: "grant-2" }, { capMicroUsdc: "249999" }, { expirySeconds: String(input.expiresAtSeconds - 1) }])
      expect((await recoverMessageAddress({ message: createPilotGrantMessage(verified, { ...fields, ...change }), signature })).toLowerCase()).not.toBe(fields.owner);
    expect(() => createPilotGrantMessage(verified, { ...fields, signer: fields.owner })).toThrow();
    expect(() => createPilotGrantMessage(verified, { ...fields, capMicroUsdc: "250001" })).toThrow();
    expect(() => createPilotGrantMessage(verified, { ...fields, expirySeconds: String(input.expiresAtSeconds + 1) })).toThrow();
  });

  it("keeps the production worker loader unavailable without fixed build pins", async () => {
    vi.stubEnv("NEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_JSON", "");
    vi.stubEnv("NEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_DIGEST", ""); vi.resetModules();
    const { compiledMainnetEnrollment } = await import("./compiled-mainnet-enrollment");
    await expect(compiledMainnetEnrollment(fixture().origin)).rejects.toThrow("unavailable");
    // Runtime environment mutation cannot replace the captured build pins.
    vi.stubEnv("NEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_JSON", JSON.stringify(fixture()));
    vi.stubEnv("NEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_DIGEST", await publicMainnetEnrollmentDigest(fixture()));
    await expect(compiledMainnetEnrollment(fixture().origin)).rejects.toThrow("unavailable");
  });
});
