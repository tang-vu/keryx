import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encodeFunctionResult } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SqliteAdapter } from "./sqlite-adapter";
import { REGISTRY_ABI } from "../registry/registry-client";
import { browserSourceRegistryId } from "../payments/browser-original-source-context";
import {
  createSyntheticBrowserOriginalSourceAuthority,
  prepareBrowserSourceSigningAdmission,
} from "../payments/browser-original-source-authority";
import { sourceItemContentVersion } from "../sources/source-item-asset";
import {
  browserQueryPolicyTypedData,
  type BrowserQueryPolicy,
} from "../payments/browser-query-policy";
import {
  browserSigningTypedData,
  serializeBrowserSigningHeader,
} from "../payments/browser-signing-original";
import {
  admitSqliteBrowserSourceSigningOriginal as nativeAdmitBrowserSourceSigningOriginal,
  initializeSqliteBrowserSourceContext,
} from "./sqlite-browser-source-context";
import type { BrowserSourceOriginalAdmission } from "./browser-signing-originals";
import type { Source, SourceItem } from "../types";
import {
  admitSqliteBrowserJournalInTransaction,
  sqliteJournalTransaction,
} from "./sqlite-browser-journal";
import { prepareBrowserJournal } from "./browser-authorization-journal";
import {
  articleOfferId,
  articleOfferTypedData,
} from "../offers/article-offer-proof";

const owner = privateKeyToAccount(generatePrivateKey());
const signer = privateKeyToAccount(generatePrivateKey());
const creator = privateKeyToAccount(generatePrivateKey());
const payout = "0x2222222222222222222222222222222222222222";
const contract = "0x3333333333333333333333333333333333333333";
const pendingFixtureCleanup: (() => Promise<void>)[] = [];
async function fixtureDeadline<T>(
  pending: Promise<T>,
  limit: number,
  stage: string
): Promise<T> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(
            `Fixture ${stage} deadline after ${Math.round(performance.now() - started)}ms`
          )),
          limit
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
type SetupStage = "constructor" | "init" | "grant" | "activation" | "source" | "items" | "query-sign" | "query-admit" | "server-listen" | "authority-resolve" | "original-admit";
async function setupStage<T>(stage: SetupStage, operation: () => T | Promise<T>): Promise<T> {
  const started = performance.now();
  const emit = (phase: "start" | "end" | "failed") => fs.writeSync(1,
    `[source-context-fixture] stage=${stage} phase=${phase} elapsedMs=${Math.min(600000, Math.max(0, Math.round(performance.now() - started)))}\n`);
  emit("start");
  try { const value = await operation(); emit("end"); return value; }
  catch (error) { emit("failed"); throw error; }
}
function admitSqliteBrowserSourceSigningOriginal(...args: Parameters<typeof nativeAdmitBrowserSourceSigningOriginal>) {
  return setupStage("original-admit", () => nativeAdmitBrowserSourceSigningOriginal(...args));
}
type FixtureResources = {
  db?: SqliteAdapter;
  native?: DatabaseSync;
  server?: Server;
  folder: string;
  closed: boolean;
};
const fixtures: FixtureResources[] = [];
async function closeFixture(f: FixtureResources) {
  f.closed = true;
  let failed = false;
  try {
    f.server?.closeAllConnections();
    if (f.server?.listening) await new Promise<void>((resolve, reject) =>
      f.server!.close((error) => (error ? reject(error) : resolve())));
  } catch { failed = true; }
  try { f.native?.close(); } catch { failed = true; }
  try { f.db?.close(); } catch { failed = true; }
  try { fs.rmSync(f.folder, { recursive: true, force: true }); } catch { failed = true; }
  if (failed) throw new Error("Fixture cleanup refused");
}
afterEach(async () => {
  let failed = false;
  try {
    for (const cleanup of pendingFixtureCleanup.splice(0)) {
      try { await cleanup(); } catch { failed = true; }
    }
  } finally {
    for (const f of fixtures.splice(0)) {
      try { await closeFixture(f); } catch { failed = true; }
    }
  }
  if (failed) throw new Error("Fixture cleanup refused");
});
async function setup(failStage?: "grant") {
  const folder = fs.mkdtempSync(
    path.join(os.tmpdir(), "keryx-source-context-")
  );
  const resources: FixtureResources = { folder, closed: false };
  fixtures.push(resources);
  const checked = async <T>(stage: SetupStage, operation: () => T | Promise<T>) => {
    if (resources.closed) throw new Error("Fixture closed");
    const result = await setupStage(stage, () => {
      if (stage === failStage) throw new Error("Injected fixture setup failure");
      return operation();
    });
    if (resources.closed) throw new Error("Fixture closed");
    return result;
  };
  const file = path.join(folder, "synthetic.sqlite");
  const db = await checked("constructor", () => resources.db = new SqliteAdapter(file));
  await checked("init", () => db.init());
  const epoch = crypto.randomUUID();
  const sessionId = owner.address.toLowerCase();
  await checked("grant", () => db.upsertSessionGrant({
    sessionId,
    sessAddr: signer.address,
    ownerAddr: owner.address,
    cap: 1,
    expiry: Date.now() + 120000,
    txHash: "synthetic",
    grantEpoch: epoch,
  }));
  await checked("activation", () => db.activateBrowserJournal());
  const native = resources.native = new DatabaseSync(file);
  const server = resources.server = createServer();
  native.exec(
    "PRAGMA busy_timeout=5000; UPDATE browser_signing_v2_control SET active=1 WHERE id=1"
  );
  const source: Source = {
    id: "source",
    name: "Source",
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
  await checked("source", () => db.upsertSource(source));
  await checked("items", () => db.addItems([item]));
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
  const querySignature = await checked("query-sign", () => owner.signTypedData(browserQueryPolicyTypedData(policy)));
  const query = await checked("query-admit", () => db.admitBrowserQueryPolicy(
    {
      policy,
      signature: querySignature,
    },
    sessionId
  ));
  if (query.status !== "admitted") throw new Error("Synthetic query refused");
  const version = sourceItemContentVersion(item);
  const input: BrowserSourceOriginalAdmission = {
    protocol: "durable-v3",
    queryNamespace: query.namespace,
    queryId: query.queryId,
    source: {
      sourceId: source.id,
      itemId: item.id,
      contentVersion: version,
      offerId: null,
    },
    journal: {
      sessionId,
      requestId: crypto.randomUUID(),
      queryId: query.queryId,
      grantEpoch: epoch,
      signer: signer.address,
      network: "eip155:5042002",
      token: "0x3600000000000000000000000000000000000000",
      gatewayContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
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
          verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        },
      },
      payment: {
        kind: "fetch",
        queryId: query.queryId,
        sourceId: source.id,
        sourceName: source.name,
        payer: signer.address,
        payee: payout,
        amountUsdc: 0.001,
        network: "eip155:5042002",
        grantEpoch: epoch,
        itemId: item.id,
        contentVersion: version,
      },
    },
  };
  let rpcCalls = 0;
  const rpc = {
    chain: "0x4cef52",
    payout,
    active: true,
    price: BigInt(1000),
    hash: `0x${"77".repeat(32)}`,
  };
  const timestamp = `0x${Math.floor(Date.now() / 1000).toString(16)}`;
  server.on("request", async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    rpcCalls++;
    const result =
      payload.method === "eth_chainId"
        ? rpc.chain
        : payload.method === "eth_call"
        ? encodeFunctionResult({
            abi: REGISTRY_ABI,
            functionName: "get",
            result: {
              creator: creator.address,
              payoutWallet: rpc.payout as `0x${string}`,
              authors: [],
              fetchPriceUsdc6: rpc.price,
              contentCid: "",
              tags: "",
              active: rpc.active,
            },
          })
        : payload.method === "eth_getBlockByNumber"
        ? {
            number: "0x1",
            hash: rpc.hash,
            timestamp,
            transactions: [],
            parentHash: rpc.hash,
            nonce: "0x0000000000000000",
            sha3Uncles: rpc.hash,
            logsBloom: `0x${"00".repeat(256)}`,
            transactionsRoot: rpc.hash,
            stateRoot: rpc.hash,
            receiptsRoot: rpc.hash,
            miner: payout,
            difficulty: "0x0",
            totalDifficulty: "0x0",
            extraData: "0x",
            size: "0x1",
            gasLimit: "0x1",
            gasUsed: "0x0",
            uncles: [],
          }
        : null;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
  });
  await checked("server-listen", async () => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    if (resources.closed) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture unavailable");
  const rpcUrl = `http://127.0.0.1:${address.port}`;
  const authority = createSyntheticBrowserOriginalSourceAuthority(
    db,
    rpcUrl,
    contract
  );
  const snapshot = () =>
    JSON.stringify(
      native.prepare("SELECT * FROM browser_signing_queries").all()
    ) +
    JSON.stringify(
      native.prepare("SELECT * FROM browser_signer_capacity").all()
    ) +
    JSON.stringify(
      native.prepare("SELECT * FROM browser_authorization_intents").all()
    ) +
    JSON.stringify(
      native.prepare("SELECT * FROM browser_signing_originals").all()
    );
  return {
    db,
    native,
    input,
    authority: { resolve: (input: BrowserSourceOriginalAdmission) => checked("authority-resolve", () => authority.resolve(input)) },
    rpc,
    snapshot,
    rpcCalls: () => rpcCalls,
    file,
    rpcUrl,
  };
}
async function discounted(
  f: Awaited<ReturnType<typeof setup>>,
  expiresAt = Math.floor(Date.now() / 1000) + 60,
  account = creator
) {
  const terms = {
    sourceId: f.input.source.sourceId,
    itemId: f.input.source.itemId,
    contentVersion: f.input.source.contentVersion,
    priceUsdc6: 100,
    expiresAt,
    nonce: `0x${"99".repeat(32)}` as `0x${string}`,
  };
  const signature = await account.signTypedData(articleOfferTypedData(terms));
  const offer = {
    ...terms,
    id: articleOfferId(signature),
    signature,
    signer: account.address,
    createdAt: new Date().toISOString(),
  };
  await f.db.setArticleOffer(offer);
  const input = structuredClone(f.input);
  input.source.offerId = offer.id;
  input.journal.offerId = offer.id;
  input.journal.amountMicroUsdc = 100;
  input.journal.requirements.amount = "100";
  input.journal.payment.offerId = offer.id;
  input.journal.payment.amountUsdc = 0.0001;
  input.journal.payment.listPriceUsdc = 0.001;
  return input;
}
it("owns and closes native resources when setup fails before grant installation", async () => {
  await expect(setup("grant")).rejects.toThrow("Injected fixture setup failure");
  const resource = fixtures.pop();
  if (!resource?.db) throw new Error("Fixture unavailable");
  const db = resource.db;
  const folder = resource.folder;
  expect(fs.existsSync(folder)).toBe(true);
  expect(resource.native).toBeUndefined();
  expect(resource.server).toBeUndefined();
  await closeFixture(resource);
  expect(resource.closed).toBe(true);
  expect(fs.existsSync(folder)).toBe(false);
  await expect(db.getSource("source")).rejects.toThrow();
});
it("installs floor2, refuses premature v3, then atomically retains original/context with exact header callback and historical replay", async () => {
  const f = await setup();
  const before = f.snapshot();
  let resolverCalls = 0;
  const unavailable = {
    resolve: async () => {
      resolverCalls++;
      throw new Error("synthetic unavailable");
    },
  };
  f.native.exec("UPDATE browser_signing_v2_control SET active=0 WHERE id=1");
  expect(
    (
      await admitSqliteBrowserSourceSigningOriginal(
        f.native,
        f.input,
        unavailable
      )
    ).status
  ).toBe("inactive");
  f.native.exec("UPDATE browser_signing_v2_control SET active=1 WHERE id=1");
  expect(
    (
      await admitSqliteBrowserSourceSigningOriginal(
        f.native,
        f.input,
        unavailable
      )
    ).status
  ).toBe("refused");
  expect(resolverCalls).toBe(0);
  expect(
    (
      await admitSqliteBrowserSourceSigningOriginal(
        f.native,
        f.input,
        f.authority
      )
    ).status
  ).toBe("refused");
  expect(f.snapshot()).toBe(before);
  expect(f.rpcCalls()).toBe(0);
  f.native.exec(
    "UPDATE browser_signing_v2_control SET min_original_version=3 WHERE id=1"
  );
  const admitted = await admitSqliteBrowserSourceSigningOriginal(
    f.native,
    f.input,
    f.authority
  );
  expect(admitted.status).toBe("admitted");
  if (admitted.status !== "admitted") throw new Error("Fixture refused");
  expect(admitted.original.protocol).toBe("durable-v3");
  expect(
    f.native.prepare("SELECT spent_micro FROM browser_signer_capacity").get()
      ?.spent_micro
  ).toBe(1000);
  f.native.exec("UPDATE browser_journal_control SET active=0 WHERE id=1");
  await expect(
    f.db.exposeBrowserJournal(
      f.input.journal.sessionId,
      f.input.journal.requestId
    )
  ).rejects.toThrow();
  f.native.exec("UPDATE browser_journal_control SET active=1 WHERE id=1");
  expect(
    await f.db.exposeBrowserJournal(
      f.input.journal.sessionId,
      f.input.journal.requestId
    )
  ).toBe(true);
  const header = serializeBrowserSigningHeader(
    admitted.original,
    await signer.signTypedData(browserSigningTypedData(admitted.original))
  );
  expect(
    await f.db.signBrowserSigningOriginal(
      f.input.journal.sessionId,
      f.input.journal.requestId,
      header
    )
  ).toBe(true);
  const retained = f.snapshot(),
    calls = f.rpcCalls();
  const changed = structuredClone(f.input);
  changed.source.contentVersion = "changed";
  expect(
    (
      await admitSqliteBrowserSourceSigningOriginal(
        f.native,
        changed,
        f.authority
      )
    ).status
  ).toBe("refused");
  expect(() =>
    f.native.exec(
      "UPDATE browser_signing_originals SET original=json_set(original,'$.sourceContext.registry.blockNumber','999')"
    )
  ).toThrow("immutable");
  expect(() => f.native.exec("DELETE FROM browser_signing_originals")).toThrow(
    "retained"
  );
  f.rpc.active = false;
  const replay = await admitSqliteBrowserSourceSigningOriginal(
    f.native,
    f.input,
    f.authority
  );
  expect(replay).toEqual({
    status: "admitted",
    journal: await f.db.getBrowserJournal(
      f.input.journal.sessionId,
      f.input.journal.requestId
    ),
    original: admitted.original,
  });
  expect(f.rpcCalls()).toBe(calls);
  expect(f.snapshot()).toBe(retained);
  const historical = await f.db.readExposedBrowserSigningSnapshotForSigner(
    signer.address,
    f.input.journal.sessionId,
    f.input.journal.requestId
  );
  expect(historical?.original).toEqual(admitted.original);
  expect(f.snapshot()).toBe(retained);
});
it("freezes private authority evidence against nested prepared-output mutation and detects changed input", async () => {
  const f = await setup();
  const token = await f.authority.resolve(f.input);
  const first = prepareBrowserSourceSigningAdmission(f.input, token);
  expect(() => {
    first.input.sourceContext.registry.payoutWallet =
      creator.address.toLowerCase();
  }).toThrow();
  expect(() => {
    first.input.sourceContext.source.registryId = `0x${"99".repeat(32)}`;
  }).toThrow();
  const second = prepareBrowserSourceSigningAdmission(f.input, token);
  expect(second.input.sourceContext).toEqual(first.input.sourceContext);
  expect(second.input.sourceContext).not.toBe(first.input.sourceContext);
  expect(second.input.sourceContext.registry).not.toBe(
    first.input.sourceContext.registry
  );
  expect(() => {
    first.input.journal.amountMicroUsdc = 1;
  }).toThrow();
  expect(() => {
    first.original.authorization.value = "1";
  }).toThrow();
  const changed = structuredClone(f.input);
  changed.source.itemId = "different";
  expect(() => prepareBrowserSourceSigningAdmission(changed, token)).toThrow(
    "refused"
  );
});
it("refuses payout/chain/version/price mismatches without creating financial state", async () => {
  const f = await setup();
  f.native.exec(
    "UPDATE browser_signing_v2_control SET min_original_version=3 WHERE id=1"
  );
  const before = f.snapshot();
  f.rpc.payout = creator.address;
  await expect(
    admitSqliteBrowserSourceSigningOriginal(f.native, f.input, f.authority)
  ).rejects.toThrow();
  f.rpc.payout = payout;
  f.rpc.chain = "0x1";
  await expect(
    admitSqliteBrowserSourceSigningOriginal(f.native, f.input, f.authority)
  ).rejects.toThrow();
  f.rpc.chain = "0x4cef52";
  f.rpc.price = BigInt(999);
  await expect(
    admitSqliteBrowserSourceSigningOriginal(f.native, f.input, f.authority)
  ).rejects.toThrow();
  f.rpc.price = BigInt(1000);
  const changed = structuredClone(f.input);
  changed.source.contentVersion = "different";
  await expect(
    admitSqliteBrowserSourceSigningOriginal(f.native, changed, f.authority)
  ).rejects.toThrow();
  expect(f.snapshot()).toBe(before);
});
it("rolls back original/context, financial reservations and private writers after a native late failure", async () => {
  const f = await setup();
  f.native
    .exec(`UPDATE browser_signing_v2_control SET min_original_version=3 WHERE id=1;
    CREATE TRIGGER synthetic_late_abort BEFORE UPDATE OF spent_micro ON browser_signing_queries
    BEGIN SELECT RAISE(ABORT,'synthetic late abort'); END;`);
  const before = f.snapshot();
  await expect(
    admitSqliteBrowserSourceSigningOriginal(f.native, f.input, f.authority)
  ).rejects.toThrow("synthetic late abort");
  expect(f.snapshot()).toBe(before);
  expect(
    f.native
      .prepare("SELECT COUNT(*) count FROM browser_signing_v2_writer")
      .get()?.count
  ).toBe(0);
  expect(
    f.native
      .prepare("SELECT COUNT(*) count FROM browser_signing_v3_writer")
      .get()?.count
  ).toBe(0);
  f.native.exec("DROP TRIGGER synthetic_late_abort");
  expect(
    (
      await admitSqliteBrowserSourceSigningOriginal(
        f.native,
        f.input,
        f.authority
      )
    ).status
  ).toBe("admitted");
  const retained = f.snapshot();
  f.native.close();
  const reopened = new DatabaseSync(f.file);
  fixtures[fixtures.length - 1].native = reopened;
  initializeSqliteBrowserSourceContext(reopened);
  expect(
    reopened
      .prepare("SELECT min_original_version FROM browser_signing_v2_control")
      .get()?.min_original_version
  ).toBe(3);
  expect(
    reopened
      .prepare("SELECT COUNT(*) count FROM browser_signing_originals")
      .get()?.count
  ).toBe(1);
  expect(
    (
      await admitSqliteBrowserSourceSigningOriginal(
        reopened,
        f.input,
        f.authority
      )
    ).status
  ).toBe("admitted");
  expect(
    JSON.stringify(
      reopened.prepare("SELECT * FROM browser_signing_queries").all()
    ) +
      JSON.stringify(
        reopened.prepare("SELECT * FROM browser_signer_capacity").all()
      ) +
      JSON.stringify(
        reopened.prepare("SELECT * FROM browser_authorization_intents").all()
      ) +
      JSON.stringify(
        reopened.prepare("SELECT * FROM browser_signing_originals").all()
      )
  ).toBe(retained);
});
it("retains the prospective floor across reset/delete/reinstall while preserving already-exposed v2 first callbacks and safe prepared cancellation", async () => {
  const f = await setup();
  const {
    protocol: _protocol,
    source: _source,
    ...legacy
  } = structuredClone(f.input);
  const exposed = await f.db.admitBrowserSigningOriginal(legacy);
  if (exposed.status !== "admitted") throw new Error("Fixture refused");
  expect(
    await f.db.exposeBrowserJournal(
      legacy.journal.sessionId,
      legacy.journal.requestId
    )
  ).toBe(true);
  const preparedInput = structuredClone(legacy);
  preparedInput.journal.requestId = crypto.randomUUID();
  const prepared = await f.db.admitBrowserSigningOriginal(preparedInput);
  expect(prepared.status).toBe("admitted");
  f.native.exec(
    "DELETE FROM browser_signing_v2_control; INSERT INTO browser_signing_v2_control(id,active,min_original_version) VALUES(1,1,3)"
  );
  expect(
    f.native
      .prepare("SELECT min_original_version FROM browser_signing_v2_barrier")
      .get()?.min_original_version
  ).toBe(3);
  expect(() =>
    f.native.exec(
      "UPDATE browser_signing_v2_control SET min_original_version=2 WHERE id=1"
    )
  ).toThrow();
  expect(() =>
    f.native.exec(
      "UPDATE browser_signing_v2_barrier SET min_original_version=2 WHERE id=1"
    )
  ).toThrow();
  expect(() =>
    f.native.exec("DELETE FROM browser_signing_v2_control")
  ).toThrow();
  initializeSqliteBrowserSourceContext(f.native);
  const before = f.snapshot();
  const next = structuredClone(legacy);
  next.journal.requestId = crypto.randomUUID();
  expect(() =>
    sqliteJournalTransaction(f.native, () => {
      f.native.prepare("INSERT INTO browser_signing_v2_writer VALUES(1)").run();
      admitSqliteBrowserJournalInTransaction(
        f.native,
        next.journal,
        prepareBrowserJournal(next.journal)
      );
    })
  ).toThrow("browser source writer required");
  expect((await f.db.admitBrowserSigningOriginal(next)).status).toBe("refused");
  await expect(f.db.admitBrowserJournal(next.journal)).rejects.toThrow();
  await expect(
    f.db.exposeBrowserJournal(
      preparedInput.journal.sessionId,
      preparedInput.journal.requestId
    )
  ).rejects.toThrow();
  expect(f.snapshot()).toBe(before);
  expect(
    await f.db.cancelPreparedBrowserJournal(
      preparedInput.journal.sessionId,
      preparedInput.journal.requestId
    )
  ).toBe(true);
  const header = serializeBrowserSigningHeader(
    exposed.original,
    await signer.signTypedData(browserSigningTypedData(exposed.original))
  );
  expect(
    await f.db.signBrowserSigningOriginal(
      legacy.journal.sessionId,
      legacy.journal.requestId,
      header
    )
  ).toBe(true);
  expect(
    (
      await f.db.readExposedBrowserSigningSnapshotForSigner(
        signer.address,
        legacy.journal.sessionId,
        legacy.journal.requestId
      )
    )?.original.protocol
  ).toBe("durable-v2");
});
it("retains the first context when exact concurrent request compositions observed different registry blocks", async () => {
  const f = await setup();
  f.native.exec(
    "UPDATE browser_signing_v2_control SET min_original_version=3 WHERE id=1"
  );
  const first = await f.authority.resolve(f.input);
  f.rpc.hash = `0x${"88".repeat(32)}`;
  const second = await f.authority.resolve(f.input);
  expect(
    prepareBrowserSourceSigningAdmission(f.input, first).input.sourceContext
      .registry.blockHash
  ).not.toBe(
    prepareBrowserSourceSigningAdmission(f.input, second).input.sourceContext
      .registry.blockHash
  );
  const [a, b] = await Promise.all([
    admitSqliteBrowserSourceSigningOriginal(f.native, f.input, {
      resolve: async () => first,
    }),
    admitSqliteBrowserSourceSigningOriginal(f.native, f.input, {
      resolve: async () => second,
    }),
  ]);
  expect(a.status).toBe("admitted");
  expect(b.status).toBe("admitted");
  if (a.status !== "admitted" || b.status !== "admitted")
    throw new Error("Fixture refused");
  expect(b.original).toEqual(a.original);
  expect(b.journal.nonce).toBe(a.journal.nonce);
  expect(
    f.native
      .prepare("SELECT COUNT(*) count FROM browser_signing_originals")
      .get()?.count
  ).toBe(1);
  expect(
    f.native.prepare("SELECT spent_micro FROM browser_signer_capacity").get()
      ?.spent_micro
  ).toBe(1000);
});
it("drains held catalog work in afterEach after an injected fixture deadline failure", async () => {
  const f = await setup();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let catalogReads = 0;
  const authority = createSyntheticBrowserOriginalSourceAuthority(
    {
      getSource: async () => {
        catalogReads++;
        await held;
        return null;
      },
      getItem: (source, item) => f.db.getItem(source, item),
      getArticleOffer: (source, item) => f.db.getArticleOffer(source, item),
    },
    f.rpcUrl,
    contract
  );
  const before = f.snapshot();
  pendingFixtureCleanup.push(async () => {
    release();
    await fixtureDeadline(collected, 1000, "injected failure drain");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(authority.resolve(f.input)).rejects.toThrow("refused");
    expect(catalogReads).toBe(9);
    expect(f.rpcCalls()).toBe(0);
    expect(f.snapshot()).toBe(before);
  });
  const collected = Promise.allSettled(
    Array.from({ length: 8 }, () => authority.resolve(f.input))
  );
  await expect(fixtureDeadline(collected, 1, "injected failure")).rejects.toThrow(
    "Fixture injected failure deadline after"
  );
  expect(catalogReads).toBe(8);
  expect(f.rpcCalls()).toBe(0);
  expect(f.snapshot()).toBe(before);
  // Deliberately leave release to afterEach, rather than an in-test finally.
});
it("bounds callers while retaining all eight hung catalog slots and performs no late RPC or financial writes", async () => {
  const f = await setup();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let catalogReads = 0;
  const catalogTasks: Promise<null>[] = [];
  const cleanup = async () => {
    release();
    await fixtureDeadline((async () => {
      await Promise.allSettled(catalogTasks);
      // Drain post-catalog refusal and retained-slot finally before closing DBs.
      await new Promise<void>((resolve) => setImmediate(resolve));
    })(), 1000, "catalog drain");
  };
  // An outer test timeout does not cancel its await or reach its finally.
  pendingFixtureCleanup.push(cleanup);
  const authority = createSyntheticBrowserOriginalSourceAuthority(
    {
      getSource: () => {
        catalogReads++;
        const pending = held.then(() => null);
        catalogTasks.push(pending);
        return pending;
      },
      getItem: (source, item) => f.db.getItem(source, item),
      getArticleOffer: (source, item) => f.db.getArticleOffer(source, item),
    },
    f.rpcUrl,
    contract
  );
  const before = f.snapshot();
  const attempts = Array.from({ length: 8 }, () => authority.resolve(f.input));
  const collected = Promise.allSettled(attempts);
  const boundedCollection = fixtureDeadline(collected, 8000, "caller collection");
  try {
    await expect(authority.resolve(f.input)).rejects.toThrow("refused");
    expect(
      (await boundedCollection).every((result) => result.status === "rejected")
    ).toBe(true);
    await expect(authority.resolve(f.input)).rejects.toThrow("refused");
    expect(catalogReads).toBe(8);
    expect(f.rpcCalls()).toBe(0);
    expect(f.snapshot()).toBe(before);
  } finally {
    await cleanup();
  }
  // The same authority can start real work only after all retained slots drain.
  await expect(authority.resolve(f.input)).rejects.toThrow("refused");
  expect(catalogReads).toBe(9);
  expect(f.rpcCalls()).toBe(0);
  expect(f.snapshot()).toBe(before);
}, 15000);
it("retains a real creator discount proof and refuses missing, wrong-creator and expired proofs without list-price fallback or citation authority", async () => {
  const f = await setup();
  f.native.exec(
    "UPDATE browser_signing_v2_control SET min_original_version=3 WHERE id=1"
  );
  const input = await discounted(f);
  const admitted = await admitSqliteBrowserSourceSigningOriginal(
    f.native,
    input,
    f.authority
  );
  expect(admitted.status).toBe("admitted");
  if (
    admitted.status !== "admitted" ||
    admitted.original.protocol !== "durable-v3"
  )
    throw new Error("Fixture refused");
  expect(admitted.original.sourceContext.price.mode).toBe("creator-offer");
  const before = f.snapshot();
  const wrong = await discounted(f, Math.floor(Date.now() / 1000) + 60, owner);
  wrong.journal.requestId = crypto.randomUUID();
  await expect(
    admitSqliteBrowserSourceSigningOriginal(f.native, wrong, f.authority)
  ).rejects.toThrow("refused");
  const expired = await discounted(f, Math.floor(Date.now() / 1000) - 1);
  expired.journal.requestId = crypto.randomUUID();
  await expect(
    admitSqliteBrowserSourceSigningOriginal(f.native, expired, f.authority)
  ).rejects.toThrow("refused");
  await f.db.deleteArticleOffer(input.source.sourceId, input.source.itemId);
  const missing = structuredClone(input);
  missing.journal.requestId = crypto.randomUUID();
  await expect(
    admitSqliteBrowserSourceSigningOriginal(f.native, missing, f.authority)
  ).rejects.toThrow("refused");
  const citation = structuredClone(missing);
  citation.journal.kind = "citation";
  citation.journal.payment.kind = "citation";
  const calls = f.rpcCalls();
  expect(
    (
      await admitSqliteBrowserSourceSigningOriginal(
        f.native,
        citation,
        f.authority
      )
    ).status
  ).toBe("refused");
  expect(f.rpcCalls()).toBe(calls);
  expect(f.snapshot()).toBe(before);
});
it("refuses a still-live authority token after its creator offer expires at actual original UTC", async () => {
  const f = await setup();
  f.native.exec(
    "UPDATE browser_signing_v2_control SET min_original_version=3 WHERE id=1"
  );
  const expiry = Math.floor(Date.now() / 1000) + 2;
  const input = await discounted(f, expiry);
  const token = await f.authority.resolve(input);
  const before = f.snapshot();
  await new Promise((resolve) =>
    setTimeout(resolve, expiry * 1000 - Date.now() + 25)
  );
  const { admitSqliteBrowserSourceOriginal } = await import(
    "./sqlite-browser-signing-originals"
  );
  expect(() =>
    admitSqliteBrowserSourceOriginal(f.native, input, token)
  ).toThrow("refused");
  expect(f.snapshot()).toBe(before);
});
it("clears both private writer markers on a non-throwing retained signer-cap refusal", async () => {
  const f = await setup();
  f.native.exec(
    "UPDATE browser_signing_v2_control SET min_original_version=3 WHERE id=1"
  );
  sqliteJournalTransaction(f.native, () => {
    f.native.exec("UPDATE session_grants SET cap=0.0005");
  });
  const before = f.snapshot();
  expect(
    (
      await admitSqliteBrowserSourceSigningOriginal(
        f.native,
        f.input,
        f.authority
      )
    ).status
  ).toBe("refused");
  expect(f.snapshot()).toBe(before);
  expect(
    f.native
      .prepare("SELECT COUNT(*) count FROM browser_signing_v2_writer")
      .get()?.count
  ).toBe(0);
  expect(
    f.native
      .prepare("SELECT COUNT(*) count FROM browser_signing_v3_writer")
      .get()?.count
  ).toBe(0);
});
