import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SqliteAdapter } from "../db/sqlite-adapter";
import {
  browserQueryPolicyTypedData,
  BROWSER_SIGNING_SERVICE,
  type BrowserQueryPolicy,
} from "./browser-query-policy";
import {
  observationTypedData,
  serializeObservationProof,
  OBSERVATION_AUDIENCE,
  OBSERVATION_PATH,
  observationUtcNow,
  type ObservationRequest,
} from "./browser-original-observation-protocol";
/** Generated unfunded native fixture only. Never prints or persists a private key. */
export async function observationFixture(exposed = true) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-observation-")),
    file = path.join(folder, "fixture.sqlite");
  const key = generatePrivateKey(),
    signer = privateKeyToAccount(key),
    owner = privateKeyToAccount(generatePrivateKey()),
    sessionId = owner.address.toLowerCase(),
    epoch = crypto.randomUUID(),
    queryId = crypto.randomUUID(),
    requestId = crypto.randomUUID(),
    payee = "0x2222222222222222222222222222222222222222";
  const db = new SqliteAdapter(file);
  await db.init();
  const native = new DatabaseSync(file);
  try {
    await db.upsertSessionGrant({
      sessionId,
      sessAddr: signer.address,
      ownerAddr: owner.address,
      cap: 0.00001,
      expiry: Date.now() + 60000,
      txHash: "synthetic",
      grantEpoch: epoch,
    });
    await db.activateBrowserJournal();
    native.exec("UPDATE browser_signing_v2_control SET active=1 WHERE id=1");
    const policy: BrowserQueryPolicy = {
      protocol: "durable-v2" as const,
      service: BROWSER_SIGNING_SERVICE,
      owner: owner.address,
      signer: signer.address,
      grantEpoch: epoch,
      queryId,
      policyId: `0x${"11".repeat(32)}` as const,
      requestNonce: `0x${"22".repeat(32)}` as const,
      questionDigest: `0x${"33".repeat(32)}` as const,
      queryCeilingMicros: "2",
      lifetimeCeilingMicros: "4",
      jobLimit: 2,
      expiresAt: Date.now() + 30000,
    };
    const q = await db.admitBrowserQueryPolicy(
      {
        policy,
        signature: await owner.signTypedData(
          browserQueryPolicyTypedData(policy)
        ),
      },
      sessionId
    );
    if (q.status !== "admitted")
      throw new Error("Synthetic observation fixture refused");
    const admitted = await db.admitBrowserSigningOriginal({
      queryNamespace: q.namespace,
      queryId,
      journal: {
        sessionId,
        requestId,
        queryId,
        grantEpoch: epoch,
        signer: signer.address,
        network: "eip155:5042002",
        token: "0x3600000000000000000000000000000000000000",
        gatewayContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        sourceId: "source",
        offerId: null,
        kind: "fetch",
        payee,
        amountMicroUsdc: 1,
        requirements: {
          scheme: "exact",
          network: "eip155:5042002",
          asset: "0x3600000000000000000000000000000000000000",
          amount: "1",
          payTo: payee,
          maxTimeoutSeconds: 691200,
          extra: {
            name: "GatewayWalletBatched",
            version: "1",
            verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
          },
        },
        payment: {
          kind: "fetch",
          queryId,
          sourceId: "source",
          sourceName: "Synthetic",
          payer: signer.address,
          payee,
          amountUsdc: 0.000001,
          network: "eip155:5042002",
          grantEpoch: epoch,
        },
      },
    });
    if (admitted.status !== "admitted")
      throw new Error("Synthetic observation fixture refused");
    if (exposed) await db.exposeBrowserJournal(sessionId, requestId);
    return {
      db,
      native,
      file,
      key,
      signer,
      owner,
      sessionId,
      requestId,
      original: admitted.original,
      async proof(overrides: Partial<ObservationRequest> = {}) {
        const utc = observationUtcNow();
        const request: ObservationRequest = {
          audience: OBSERVATION_AUDIENCE,
          method: "GET",
          path: OBSERVATION_PATH,
          sessionId,
          requestId,
          challenge: `0x${"44".repeat(32)}`,
          issuedAtMs: String(utc),
          expiresAtMs: String(utc + 5000),
          ...overrides,
        };
        return {
          request,
          header: serializeObservationProof(
            request,
            await signer.signTypedData(observationTypedData(request))
          ),
        };
      },
      state() {
        return JSON.stringify(
          native
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            .all()
            .map((r) => [
              r.name,
              native
                .prepare(
                  'SELECT * FROM "' + String(r.name).replaceAll('"', '""') + '"'
                )
                .all(),
            ])
        );
      },
      close() {
        native.close();
        db.close();
        fs.rmSync(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    native.close();
    db.close();
    fs.rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}
