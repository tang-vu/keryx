import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteAdapter } from "./sqlite-adapter";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import {
  inspectSqliteEnrollment,
  enrollSqliteStorage,
} from "./storage-identity-provision";
import { STORAGE_APPLICATION_TABLES } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { scanFullStorageSnapshot } from "./storage-identity-snapshot";
import { createServer } from "node:http";
import { once } from "node:events";
import { encodeFunctionResult } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { REGISTRY_ABI } from "../registry/registry-abi";
import { browserSourceRegistryId } from "../payments/browser-original-source-context";
import { createSyntheticBrowserOriginalSourceAuthority } from "../payments/browser-original-source-authority";
import { sourceItemContentVersion } from "../sources/source-item-asset";
import {
  browserQueryPolicyTypedData,
  type BrowserQueryPolicy,
} from "../payments/browser-query-policy";
import {
  admitSqliteBrowserQueryPolicy,
  readExposedSqliteBrowserSigningSnapshotForSigner,
} from "./sqlite-browser-signing-originals";
import { admitSqliteBrowserSourceSigningOriginal } from "./sqlite-browser-source-context";
import {
  transitionSqliteBrowserJournal,
  activateSqliteBrowserJournal,
  upsertSqliteJournalGrant,
} from "./sqlite-browser-journal";
import type { BrowserSourceOriginalAdmission } from "./browser-signing-originals";
import type { Source, SourceItem } from "../types";

it("enrolls the actual full application schema and covers every installed table", async () => {
  const folder = mkdtempSync(join(tmpdir(), "keryx-storage-browser-schema-"));
  const file = join(folder, "synthetic.sqlite");
  const adapter = new SqliteAdapter(file);
  try {
    await adapter.init();
  } finally {
    adapter.close();
  }
  try {
    const native = new DatabaseSync(file);
    const tables = native
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .all()
      .map((row) => String(row.name));
    native.close();
    const identity = syntheticStorageIdentity("testnet-real");
    const inspection = await inspectSqliteEnrollment(file, identity);
    expect(inspection.enrollmentRefusal).toBeUndefined();
    expect(
      tables.filter((name) => !STORAGE_APPLICATION_TABLES.includes(name))
    ).toEqual([]);
    await enrollSqliteStorage(file, identity, {
      format: "keryx-reviewed-storage-enrollment-v1",
      inspection,
      provenanceDocumentDigest: identity.provenanceDigest,
      unknownClassAttestation: inspection.unknownClasses,
    });
    const before = readFileSync(file);
    expect(() =>
      openVerifiedSqliteStorage(file, {
        ...identity,
        storageId: crypto.randomUUID(),
      })
    ).toThrow("identity_mismatch");
    const missing = join(folder, "missing.sqlite");
    expect(() => openVerifiedSqliteStorage(missing, identity)).toThrow();
    expect(existsSync(missing)).toBe(false);
    expect(readFileSync(file)).toEqual(before);
    const verified = openVerifiedSqliteStorage(file, identity);
    try {
      expect(verified.db.isTransaction).toBe(false);
      verified.db.exec("BEGIN");
      expect(verified.db.isTransaction).toBe(true);
      verified.db.exec("ROLLBACK");
      for (const table of tables) {
        const fences = verified.db
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=? AND name LIKE 'storage_fence_%'"
          )
          .all(table);
        expect(fences).toHaveLength(3);
        for (const operation of ["INSERT", "UPDATE", "DELETE"])
          expect(
            fences.some((row) =>
              String(row.sql).includes(`BEFORE ${operation} ON`)
            )
          ).toBe(true);
      }
      expect(
        verified.db
          .prepare("SELECT count(*) AS n FROM browser_signing_originals")
          .get()?.n
      ).toBe(0);
      for (const property of [
        "function",
        "setAuthorizer",
        "loadExtension",
        "createSession",
      ])
        expect(() => Reflect.get(verified.db, property)).toThrow(
          "Unsupported verified storage operation"
        );
    } finally {
      verified.close();
    }
    expect(() => verified.db.isTransaction).toThrow("closed");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

const retainedAuthoritySeeds = [
  "INSERT INTO browser_signing_v2_writer VALUES(1)",
  "INSERT INTO browser_signing_v3_writer VALUES(1)",
  "INSERT INTO browser_signing_namespaces(namespace,owner,signer,service,network,ceiling_micro,job_limit,allocated_micro,jobs,proof) VALUES('namespace','owner','signer','https://keryx.cc','eip155:5042002',1,1,0,0,'{}')",
  "INSERT INTO browser_signing_queries(query_id,namespace,policy_id,request_nonce,session_id,grant_epoch,proof,proof_digest,ceiling_micro,spent_micro) VALUES('query','namespace','policy','nonce','session','epoch','{}','digest',1,0)",
  "INSERT INTO browser_signing_originals(nonce,query_id,original,input) VALUES('nonce','query','{\"protocol\":\"durable-v2\"}','{}')",
  "UPDATE browser_signing_v2_control SET active=1 WHERE id=1",
  "UPDATE browser_signing_v2_barrier SET ever_active=1 WHERE id=1",
  "UPDATE browser_signing_v2_control SET min_original_version=3 WHERE id=1",
  "UPDATE browser_signing_v2_barrier SET min_original_version=3 WHERE id=1",
  "DELETE FROM browser_signing_v2_control",
  "DROP TRIGGER browser_signing_v2_barrier_retained; DELETE FROM browser_signing_v2_barrier",
  "DROP TABLE browser_signing_v2_control; CREATE TABLE browser_signing_v2_control(id INTEGER,active TEXT,min_original_version INTEGER); INSERT INTO browser_signing_v2_control VALUES(1,'0',2)",
  "DROP TABLE browser_signing_v2_barrier; CREATE TABLE browser_signing_v2_barrier(id INTEGER,ever_active INTEGER,min_original_version INTEGER); INSERT INTO browser_signing_v2_barrier VALUES(1,0,2),(2,0,2)",
];
it.each(retainedAuthoritySeeds)(
  "refuses retained authority without mutation: %s",
  async (seed) => {
    const folder = mkdtempSync(join(tmpdir(), "keryx-storage-retained-"));
    const file = join(folder, "synthetic.sqlite");
    const adapter = new SqliteAdapter(file);
    let raw: DatabaseSync | undefined;
    try {
      await adapter.init();
      adapter.close();
      raw = new DatabaseSync(file);
      const isolatedTable = seed.startsWith(
        "INSERT INTO browser_signing_queries"
      )
        ? "browser_signing_queries"
        : seed.startsWith("INSERT INTO browser_signing_originals")
        ? "browser_signing_originals"
        : null;
      if (isolatedTable) {
        // Scan the actual installed table definition in isolation so a funded
        // parent/grant cannot accidentally supply the refusal under test.
        const installedSql = String(
          raw
            .prepare(
              "SELECT sql FROM sqlite_schema WHERE type='table' AND name=?"
            )
            .get(isolatedTable)?.sql
        );
        raw.close();
        rmSync(file);
        raw = new DatabaseSync(file, { enableForeignKeyConstraints: false });
        raw.exec(installedSql);
      }
      // Privileged synthetic pre-enrollment history: never alter production guards.
      raw.exec(seed);
      raw.exec("BEGIN");
      const before = scanFullStorageSnapshot(raw);
      raw.exec("ROLLBACK");
      raw.close();
      raw = undefined;
      const bytes = readFileSync(file);
      const identity = syntheticStorageIdentity("testnet-real");
      const inspection = await inspectSqliteEnrollment(file, identity);
      expect(inspection.enrollmentRefusal).toBe(
        "unresolved_funded_or_authority_provenance"
      );
      expect(
        inspection.unknownClasses.some((value) =>
          value.startsWith("legacy_metadata:browser_signing_")
        )
      ).toBe(false);
      await expect(
        enrollSqliteStorage(file, identity, {
          format: "keryx-reviewed-storage-enrollment-v1",
          inspection,
          provenanceDocumentDigest: identity.provenanceDigest,
          unknownClassAttestation: inspection.unknownClasses,
        })
      ).rejects.toThrow("unresolved_funded_or_authority_provenance");
      expect(readFileSync(file)).toEqual(bytes);
      raw = new DatabaseSync(file);
      raw.exec("BEGIN");
      expect(scanFullStorageSnapshot(raw)).toEqual(before);
      expect(
        raw
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='keryx_storage_identity'"
          )
          .get()
      ).toBeUndefined();
      raw.exec("ROLLBACK");
    } finally {
      raw?.close();
      try {
        adapter.close();
      } catch {
        /* already closed */
      }
      rmSync(folder, { recursive: true, force: true });
    }
  },
  60000
);

it("revalidates identity and complete fences before returning the transaction boolean", async () => {
  for (const tamper of ["identity", "fence", "replacement"] as const) {
    const folder = mkdtempSync(join(tmpdir(), "keryx-storage-transaction-"));
    const file = join(folder, "synthetic.sqlite");
    const adapter = new SqliteAdapter(file);
    let verified: ReturnType<typeof openVerifiedSqliteStorage> | undefined;
    let raw: DatabaseSync | undefined;
    try {
      await adapter.init();
      adapter.close();
      const identity = syntheticStorageIdentity("testnet-real");
      const inspection = await inspectSqliteEnrollment(file, identity);
      await enrollSqliteStorage(file, identity, {
        format: "keryx-reviewed-storage-enrollment-v1",
        inspection,
        provenanceDocumentDigest: identity.provenanceDigest,
        unknownClassAttestation: inspection.unknownClasses,
      });
      verified = openVerifiedSqliteStorage(file, identity);
      expect(verified.db.isTransaction).toBe(false);
      raw = new DatabaseSync(file);
      if (tamper === "identity") {
        const sql = String(
          raw
            .prepare(
              "SELECT sql FROM sqlite_schema WHERE name='storage_identity_no_update'"
            )
            .get()?.sql
        );
        raw.exec("DROP TRIGGER storage_identity_no_update");
        raw
          .prepare("UPDATE keryx_storage_identity SET identity=? WHERE id=1")
          .run(JSON.stringify({ ...identity, storageId: crypto.randomUUID() }));
        raw.exec(sql);
      } else if (tamper === "fence") {
        const fence = raw
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type='trigger' AND tbl_name='browser_signing_originals' AND name LIKE 'storage_fence_%' LIMIT 1"
          )
          .get();
        raw.exec(`DROP TRIGGER "${String(fence?.name)}"`);
      } else {
        raw.close();
        raw = undefined;
        if (process.platform === "win32") {
          // The actual open native SQLite handle prevents replacement on Windows.
          const before = readFileSync(file);
          expect(() => renameSync(file, `${file}.retained`)).toThrow(
            expect.objectContaining({ code: "EBUSY" })
          );
          expect(readFileSync(file)).toEqual(before);
          expect(verified.db.isTransaction).toBe(false);
          continue;
        }
        renameSync(file, `${file}.retained`);
        new DatabaseSync(file).close();
      }
      expect(() => verified!.db.isTransaction).toThrow(
        tamper === "identity"
          ? "identity_mismatch"
          : tamper === "fence"
          ? "fence_missing_or_changed"
          : "target_replaced"
      );
    } finally {
      raw?.close();
      verified?.close();
      try {
        adapter.close();
      } catch {
        /* already closed */
      }
      rmSync(folder, { recursive: true, force: true });
    }
  }
});

it("admits and exposes a v3 original through enrolled storage while retaining every independent writer fence", async () => {
  const folder = mkdtempSync(join(tmpdir(), "keryx-storage-original-"));
  const file = join(folder, "synthetic.sqlite");
  const owner = privateKeyToAccount(generatePrivateKey());
  const signer = privateKeyToAccount(generatePrivateKey());
  const creator = privateKeyToAccount(generatePrivateKey());
  const payout = "0x2222222222222222222222222222222222222222";
  const registry = "0x3333333333333333333333333333333333333333";
  const epoch = crypto.randomUUID();
  const sessionId = owner.address.toLowerCase();
  const identity = syntheticStorageIdentity("testnet-real");
  const source: Source = {
    id: "source",
    name: "Synthetic source",
    url: "https://source.example/",
    description: "fixture",
    walletAddress: payout,
    fetchPrice: 0.001,
    tags: [],
    authors: [],
    createdAt: new Date().toISOString(),
    active: true,
    verified: true,
    onchainId: browserSourceRegistryId(
      creator.address,
      "https://source.example/"
    ),
  };
  const item: SourceItem = {
    id: "item",
    sourceId: source.id,
    title: "Fixture",
    summary: "Preview",
    content: "Synthetic body",
    link: "https://source.example/item",
  };
  const adapter = new SqliteAdapter(file);
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const result =
      payload.method === "eth_chainId"
        ? "0x4cef52"
        : payload.method === "eth_call"
        ? encodeFunctionResult({
            abi: REGISTRY_ABI,
            functionName: "get",
            result: {
              creator: creator.address,
              payoutWallet: payout,
              authors: [],
              fetchPriceUsdc6: BigInt(1000),
              contentCid: "",
              tags: "",
              active: true,
            },
          })
        : {
            number: "0x1",
            hash: `0x${"77".repeat(32)}`,
            timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
          };
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
  });
  let verified: ReturnType<typeof openVerifiedSqliteStorage> | undefined;
  let raw: DatabaseSync | undefined;
  try {
    await adapter.init();
    adapter.close();
    const inspection = await inspectSqliteEnrollment(file, identity);
    await enrollSqliteStorage(file, identity, {
      format: "keryx-reviewed-storage-enrollment-v1",
      inspection,
      provenanceDocumentDigest: identity.provenanceDigest,
      unknownClassAttestation: inspection.unknownClasses,
    });
    verified = openVerifiedSqliteStorage(file, identity);
    activateSqliteBrowserJournal(verified.db);
    upsertSqliteJournalGrant(verified.db, {
      sessionId,
      sessAddr: signer.address,
      ownerAddr: owner.address,
      cap: 1,
      expiry: Date.now() + 120000,
      txHash: "synthetic",
      grantEpoch: epoch,
    });
    verified.db.exec(
      "UPDATE browser_signing_v2_control SET active=1,min_original_version=3 WHERE id=1"
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const policy: BrowserQueryPolicy = {
      protocol: "durable-v2",
      service: "https://keryx.cc",
      owner: owner.address,
      signer: signer.address,
      policyId: `0x${"44".repeat(32)}`,
      grantEpoch: epoch,
      requestNonce: `0x${"55".repeat(32)}`,
      queryId: crypto.randomUUID(),
      questionDigest: `0x${"66".repeat(32)}`,
      queryCeilingMicros: "2000",
      lifetimeCeilingMicros: "4000",
      jobLimit: 2,
      expiresAt: Date.now() + 60000,
    };
    const admitted = await admitSqliteBrowserQueryPolicy(
      verified.db,
      {
        policy,
        signature: await owner.signTypedData(
          browserQueryPolicyTypedData(policy)
        ),
      },
      sessionId
    );
    if (admitted.status !== "admitted")
      throw new Error("Synthetic query refused");
    const input: BrowserSourceOriginalAdmission = {
      protocol: "durable-v3",
      queryNamespace: admitted.namespace,
      queryId: admitted.queryId,
      source: {
        sourceId: source.id,
        itemId: item.id,
        contentVersion: sourceItemContentVersion(item),
        offerId: null,
      },
      journal: {
        sessionId,
        requestId: crypto.randomUUID(),
        queryId: admitted.queryId,
        grantEpoch: epoch,
        signer: signer.address,
        network: "eip155:5042002",
        token: "0x3600000000000000000000000000000000000000",
        gatewayContract: "0x0077777d7eba4688bdef3e311b846f25870a19b9",
        sourceId: source.id,
        offerId: null,
        kind: "fetch",
        payee: payout,
        amountMicroUsdc: 1000,
        requirements: {
          scheme: "exact",
          network: "eip155:5042002",
          asset: "0x3600000000000000000000000000000000000000",
          amount: "1000",
          payTo: payout,
          maxTimeoutSeconds: 691200,
          extra: {
            name: "GatewayWalletBatched",
            version: "1",
            verifyingContract: "0x0077777d7eba4688bdef3e311b846f25870a19b9",
          },
        },
        payment: {
          kind: "fetch",
          queryId: admitted.queryId,
          sourceId: source.id,
          sourceName: source.name,
          payer: signer.address,
          payee: payout,
          amountUsdc: 0.001,
          network: "eip155:5042002",
          grantEpoch: epoch,
          itemId: item.id,
          contentVersion: sourceItemContentVersion(item),
        },
      },
    };
    const authority = createSyntheticBrowserOriginalSourceAuthority(
      {
        getSource: async () => source,
        getItem: async () => item,
        getArticleOffer: async () => null,
      },
      `http://127.0.0.1:${port}`,
      registry
    );
    const result = await admitSqliteBrowserSourceSigningOriginal(
      verified.db,
      input,
      authority
    );
    expect(result.status).toBe("admitted");
    expect(
      transitionSqliteBrowserJournal(
        verified.db,
        sessionId,
        input.journal.requestId,
        "prepared",
        "exposed"
      )
    ).toBe(true);
    const snapshot = await readExposedSqliteBrowserSigningSnapshotForSigner(
      verified.db,
      signer.address,
      sessionId,
      input.journal.requestId
    );
    expect(snapshot?.original.protocol).toBe("durable-v3");
    expect(snapshot?.journal.phase).toBe("exposed");
    expect(snapshot?.query.spentMicros).toBe("1000");
    raw = new DatabaseSync(file);
    for (const sql of [
      "UPDATE browser_signing_v2_control SET active=active",
      "UPDATE browser_signing_v2_barrier SET min_original_version=min_original_version",
      "INSERT INTO browser_signing_v2_writer VALUES(1)",
      "INSERT INTO browser_signing_v3_writer VALUES(1)",
      "DELETE FROM browser_signing_namespaces",
      "DELETE FROM browser_signing_queries",
      "DELETE FROM browser_signing_originals",
    ])
      expect(() => raw!.exec(sql)).toThrow();
    expect(() =>
      verified!.db.exec("UPDATE browser_signing_queries SET spent_micro=0")
    ).toThrow();
    expect(() =>
      verified!.db
        .prepare("UPDATE keryx_storage_identity SET identity=? WHERE id=1")
        .run(JSON.stringify({ ...identity, storageId: crypto.randomUUID() }))
    ).toThrow();
    expect(() =>
      verified!.db.exec(
        "INSERT INTO browser_signing_originals SELECT * FROM browser_signing_originals"
      )
    ).toThrow();
    expect(
      await readExposedSqliteBrowserSigningSnapshotForSigner(
        verified.db,
        signer.address,
        sessionId,
        input.journal.requestId
      )
    ).toEqual(snapshot);
  } finally {
    raw?.close();
    verified?.close();
    try {
      adapter.close();
    } catch {
      /* already closed */
    }
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    rmSync(folder, { recursive: true, force: true });
  }
});
