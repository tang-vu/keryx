import { expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { observationFixture } from "./browser-original-observation.test-fixture";
import {
  createOriginalObservationServer,
  createSyntheticOriginalObservationServer,
} from "./browser-original-observation-server";
import {
  OBSERVATION_AUDIENCE,
  OBSERVATION_PATH,
  observationTypedData,
  serializeObservationProof,
  observationUtcNow,
} from "./browser-original-observation-protocol";
const get = (header: string) =>
  new Request(OBSERVATION_AUDIENCE + OBSERVATION_PATH, {
    headers: { "X-Keryx-Observation-Proof": header },
  });
it("verifies real signer before one readonly backend read and returns no permission fields", async () => {
  const f = await observationFixture();
  try {
    const before = f.state(),
      p = await f.proof();
    let reads = 0;
    const handler = createOriginalObservationServer({
      async readExposedBrowserSigningSnapshotForSigner(...args) {
        reads++;
        return f.db.readExposedBrowserSigningSnapshotForSigner(...args);
      },
    });
    const response = await handler(get(p.header)),
      body = await response.json();
    expect(response.status).toBe(200);
    expect(body.readOnly).toBe(true);
    expect("signingAllowed" in body).toBe(false);
    expect(reads).toBe(1);
    expect(f.state() === before).toBe(true);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  } finally {
    f.close();
  }
});
it("refuses malformed auth without reads and foreign signer without original bytes", async () => {
  const f = await observationFixture();
  try {
    let reads = 0;
    const handler = createOriginalObservationServer({
      async readExposedBrowserSigningSnapshotForSigner(...args) {
        reads++;
        return f.db.readExposedBrowserSigningSnapshotForSigner(...args);
      },
    });
    expect((await handler(get("invalid"))).status).toBe(503);
    expect(reads).toBe(0);
    const p = await f.proof(),
      other = privateKeyToAccount(generatePrivateKey()),
      header = serializeObservationProof(
        p.request,
        await other.signTypedData(observationTypedData(p.request))
      ),
      response = await handler(get(header)),
      text = await response.text();
    expect(response.status).toBe(503);
    expect(text.includes(f.original.authorization.nonce)).toBe(false);
    expect(text).toBe('{"error":"original_observation_unavailable"}');
    expect(reads).toBe(1);
  } finally {
    f.close();
  }
});
it("prepared and cancelled records never return nonce, tuple or approval proof", async () => {
  const f = await observationFixture(false);
  try {
    for (const cancel of [false, true]) {
      if (cancel)
        await f.db.cancelPreparedBrowserJournal(f.sessionId, f.requestId);
      const before = f.state(),
        p = await f.proof(),
        response = await createOriginalObservationServer(f.db)(get(p.header));
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(text.includes(f.original.authorization.nonce)).toBe(false);
      expect(text.includes("policy")).toBe(false);
      expect(f.state() === before).toBe(true);
    }
  } finally {
    f.close();
  }
});
it("server phase guard refuses a prepared snapshot even from trusted composition", async () => {
  const f = await observationFixture(false);
  try {
    const snapshot = await f.db.readBrowserSigningSnapshot(
        f.sessionId,
        f.sessionId,
        f.requestId
      ),
      p = await f.proof();
    const response = await createOriginalObservationServer({
      async readExposedBrowserSigningSnapshotForSigner() {
        return snapshot;
      },
    })(get(p.header));
    expect(response.status).toBe(503);
    expect((await response.text()).includes("authorization")).toBe(false);
  } finally {
    f.close();
  }
});
it("expired proof after held read returns fixed refusal and holds all work slots", async () => {
  const f = await observationFixture();
  const resolvers: Array<(v: null) => void> = [];
  try {
    let reads = 0;
    const handler = createSyntheticOriginalObservationServer(
      {
        readExposedBrowserSigningSnapshotForSigner() {
          reads++;
          return new Promise((resolve) => resolvers.push(resolve));
        },
      },
      "http://127.0.0.1:3939",
      500
    );
    const p = await f.proof(),
      req = () =>
        new Request("http://127.0.0.1:3939" + OBSERVATION_PATH, {
          headers: { "X-Keryx-Observation-Proof": p.header },
        });
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => handler(req()))
    );
    expect(responses.every((r) => r.status === 503)).toBe(true);
    expect(reads).toBe(8);
    await new Promise((resolve) => setTimeout(resolve, 1050));
    expect((await handler(req())).status).toBe(503);
    expect(reads).toBe(8);
    resolvers.shift()?.(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = handler(req());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reads).toBe(9);
    resolvers.splice(0).forEach((resolve) => resolve(null));
    expect((await pending).status).toBe(503);
  } finally {
    resolvers.splice(0).forEach((resolve) => resolve(null));
    f.close();
  }
});

it("refuses a genuinely expired proof after successful read while total lifetime remains live", async () => {
  const f = await observationFixture();
  try {
    const utc = observationUtcNow(),
      p = await f.proof({
        issuedAtMs: String(utc - 3800),
        expiresAtMs: String(utc + 1200),
      }),
      before = f.state();
    let reads = 0;
    const handler = createOriginalObservationServer({
      async readExposedBrowserSigningSnapshotForSigner(...args) {
        reads++;
        await new Promise((resolve) => setTimeout(resolve, 1400));
        return f.db.readExposedBrowserSigningSnapshotForSigner(...args);
      },
    });
    const response = await handler(get(p.header));
    expect(reads).toBe(1);
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text.includes(f.original.authorization.nonce)).toBe(false);
    expect(text).toBe('{"error":"original_observation_unavailable"}');
    expect(f.state() === before).toBe(true);
  } finally {
    f.close();
  }
});
