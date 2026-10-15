import { describe, expect, it } from "vitest";
import { validatePendingOwnerAdmissionCandidate } from "./pending-owner-association";

function candidate() {
  const observedAtMs = Date.parse("2026-10-15T00:00:00.000Z");
  const session = { hash: "b".repeat(64), wallet: `0x${"c".repeat(40)}`,
    issuedAt: observedAtMs - 1000, expiresAt: observedAtMs + 1000 };
  return { original: { id: `a2a_${"a".repeat(64)}`, queryId: `a2a_${"a".repeat(64)}`,
    requestHash: "d".repeat(64), network: "eip155:5042", createdAt: new Date(observedAtMs).toISOString() },
    creation: "new", authenticatedSession: session, retainedSession: { ...session }, observedAtMs };
}

describe("pending ownership candidate (not an admission capability)", () => {
  it("returns only a validated candidate, without an owner grant or payment fields", () => {
    const value = candidate();
    expect(validatePendingOwnerAdmissionCandidate(value)).toEqual(value);
    expect(value).not.toHaveProperty("owner");
    expect(value).not.toHaveProperty("payer");
    expect(value).not.toHaveProperty("visibility");
  });
  it.each(["existing", "unknown"])("refuses %s original evidence even with a matching session", creation => {
    expect(() => validatePendingOwnerAdmissionCandidate({ ...candidate(), creation })).toThrow("existing_original");
  });
  it("refuses a revoked or missing session rather than substituting a payer", () => {
    expect(() => validatePendingOwnerAdmissionCandidate({ ...candidate(), retainedSession: null })).toThrow("session_unavailable");
    const value = candidate();
    expect(() => validatePendingOwnerAdmissionCandidate({ ...value, retainedSession: null,
      payer: value.authenticatedSession.wallet })).toThrow("invalid_admission");
  });
  it.each(["hash", "wallet", "issuedAt", "expiresAt"] as const)("refuses changed original-session %s", field => {
    const value = candidate();
    const replacements = { hash: "e".repeat(64), wallet: `0x${"f".repeat(40)}`,
      issuedAt: value.observedAtMs - 2000, expiresAt: value.observedAtMs + 2000 };
    expect(() => validatePendingOwnerAdmissionCandidate({ ...value,
      retainedSession: { ...value.retainedSession, [field]: replacements[field] } })).toThrow("session_unavailable");
  });
  it.each(["expired", "future", "reversed"])("refuses %s session evidence", kind => {
    const value = candidate();
    const session = { ...value.authenticatedSession,
      ...(kind === "expired" ? { expiresAt: value.observedAtMs } : kind === "future"
        ? { issuedAt: value.observedAtMs + 1 } : { expiresAt: value.authenticatedSession.issuedAt }) };
    expect(() => validatePendingOwnerAdmissionCandidate({ ...value,
      authenticatedSession: session, retainedSession: { ...session } })).toThrow("session_unavailable");
  });
  it("binds the exact original/query and original creation instant", () => {
    const value = candidate();
    expect(() => validatePendingOwnerAdmissionCandidate({ ...value,
      original: { ...value.original, queryId: `a2a_${"e".repeat(64)}` } })).toThrow("invalid_admission");
    expect(() => validatePendingOwnerAdmissionCandidate({ ...value, observedAtMs: value.observedAtMs + 1 })).toThrow("invalid_admission");
  });
  it.each(["owner", "payer", "token", "workerInput", "payment", "visibility", "status"])("rejects injected %s authority", field => {
    expect(() => validatePendingOwnerAdmissionCandidate({ ...candidate(), [field]: "untrusted" })).toThrow("invalid_admission");
  });
  it("rejects raw credentials, foreign networks, unbounded hashes and missing authentication", () => {
    const value = candidate();
    for (const input of [undefined, {}, { ...value, authenticatedSession: undefined },
      { ...value, authenticatedSession: { ...value.authenticatedSession, token: "raw-secret" } },
      { ...value, original: { ...value.original, network: "arc" } },
      { ...value, original: { ...value.original, requestHash: "d".repeat(65) } }])
      expect(() => validatePendingOwnerAdmissionCandidate(input)).toThrow("invalid_admission");
  });
});
