import { expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { observationFixture } from "./browser-original-observation.test-fixture";
import {
  OBSERVATION_PATH,
  observationTypedData,
  recoverObservationProof,
  serializeObservationProof,
  observationRequestSchema,
  ObservationElapsedGuard,
  projectOriginalObservation,
  validateOriginalObservation,
  observationRequestDigest,
  observationUtcNow,
} from "./browser-original-observation-protocol";
it("recovers actual observation EOA and captures proof input before awaits", async () => {
  const f = await observationFixture();
  try {
    const p = await f.proof();
    const r = await recoverObservationProof(p.header);
    expect(r.signer === f.signer.address.toLowerCase()).toBe(true);
    expect(r.request.path).toBe(OBSERVATION_PATH);
  } finally {
    f.close();
  }
});
it("rejects economic/owner assertions, wrong paths, noncanonical proof and raised expiry", async () => {
  const f = await observationFixture();
  try {
    const p = await f.proof();
    for (const extra of [
      { owner: f.owner.address },
      { path: "/api/ask/sign" },
      { method: "POST" },
      { expiresAtMs: String(Number(p.request.expiresAtMs) + 1) },
    ])
      expect(
        observationRequestSchema.safeParse({ ...p.request, ...extra }).success
      ).toBe(false);
    const raw = JSON.parse(atob(p.header));
    await expect(
      recoverObservationProof(btoa(JSON.stringify(raw, null, 2)))
    ).rejects.toThrow();
    await expect(recoverObservationProof("A".repeat(4097))).rejects.toThrow();
  } finally {
    f.close();
  }
});
it("rejects valid signature from another domain and expired signed observations", async () => {
  const f = await observationFixture();
  try {
    const p = await f.proof();
    const account = privateKeyToAccount(generatePrivateKey()),
      typed = observationTypedData(p.request),
      sig = await account.signTypedData({
        ...typed,
        domain: { ...typed.domain, name: "GatewayWalletBatched" },
      });
    const r = await recoverObservationProof(
      serializeObservationProof(p.request, sig)
    );
    expect(r.signer !== account.address.toLowerCase()).toBe(true);
    const expiredUtc = observationUtcNow();
    await expect(
      f
        .proof({
          issuedAtMs: String(expiredUtc - 6000),
          expiresAtMs: String(expiredUtc - 1000),
        })
        .then((p) => recoverObservationProof(p.header))
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});
it("refuses prepared economic projection and validates copied frozen exposed state", async () => {
  const f = await observationFixture(false);
  try {
    const prepared = await f.db.readBrowserSigningSnapshot(
      f.sessionId,
      f.sessionId,
      f.requestId
    );
    if (!prepared) throw new Error("Fixture unavailable");
    expect(() => projectOriginalObservation(prepared)).toThrow();
    await f.db.exposeBrowserJournal(f.sessionId, f.requestId);
    const snapshot = await f.db.readBrowserSigningSnapshot(
      f.sessionId,
      f.sessionId,
      f.requestId
    );
    if (!snapshot) throw new Error("Fixture unavailable");
    const p = await f.proof(),
      utc = observationUtcNow(),
      response = {
        version: "1",
        readOnly: true,
        challenge: p.request.challenge,
        requestDigest: observationRequestDigest(p.request),
        readInterval: { startedAtMs: utc, finishedAtMs: utc },
        state: projectOriginalObservation(snapshot),
      };
    const pending = validateOriginalObservation(
      response,
      p.request,
      f.signer.address
    );
    response.state.policy.policy.queryCeilingMicros = "99";
    const result = await pending;
    expect(result.state.query.ceilingMicros).toBe("2");
    expect(Object.isFrozen(result.state)).toBe(true);
    await expect(
      validateOriginalObservation(
        { ...response, signingAllowed: true },
        p.request,
        f.signer.address
      )
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});
it("fences blocked event-loop expiry even before timer delivery", () => {
  const guard = new ObservationElapsedGuard(30);
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    expect(() => guard.live()).toThrow();
  } finally {
    guard.close();
  }
});
