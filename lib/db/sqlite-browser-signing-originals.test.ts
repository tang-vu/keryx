import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { SqliteAdapter } from "./sqlite-adapter";
import {
  browserQueryPolicyTypedData,
  BROWSER_SIGNING_SERVICE,
  type BrowserQueryPolicy,
} from "../payments/browser-query-policy";
import {
  browserSigningTypedData,
  serializeBrowserSigningHeader,
} from "../payments/browser-signing-original";
import {
  prepareBrowserJournal,
  type BrowserJournalAdmission,
} from "./browser-authorization-journal";
import { admitSqliteBrowserJournalInTransaction } from "./sqlite-browser-journal";
import { initializeSqliteBrowserSigningOriginals } from "./sqlite-browser-signing-originals";
import {
  validateBrowserSigningSnapshot,
  type BrowserOriginalAdmission,
} from "./browser-signing-originals";
const owner = privateKeyToAccount(generatePrivateKey()),
  signer = privateKeyToAccount(generatePrivateKey());
const ownerId = owner.address.toLowerCase(),
  epoch = crypto.randomUUID(),
  payee = "0x2222222222222222222222222222222222222222";
const fixtures: { db: SqliteAdapter; native: DatabaseSync; folder: string }[] =
  [];
const grant = (selectedEpoch = epoch, sessionId = ownerId) => ({
  sessionId,
  sessAddr: signer.address,
  ownerAddr: owner.address,
  cap: 0.00001,
  expiry: Date.now() + 120000,
  txHash: "synthetic",
  grantEpoch: selectedEpoch,
});
const body = (
  overrides: Partial<BrowserQueryPolicy> = {}
): BrowserQueryPolicy => ({
  protocol: "durable-v2",
  service: BROWSER_SIGNING_SERVICE,
  owner: owner.address,
  signer: signer.address,
  policyId: `0x${crypto.randomUUID().replaceAll("-", "").repeat(2)}`,
  grantEpoch: epoch,
  requestNonce: `0x${crypto.randomUUID().replaceAll("-", "").repeat(2)}`,
  queryId: crypto.randomUUID(),
  questionDigest: `0x${"33".repeat(32)}`,
  queryCeilingMicros: "2",
  lifetimeCeilingMicros: "4",
  jobLimit: 2,
  expiresAt: Date.now() + 60000,
  ...overrides,
});
async function proof(p = body()) {
  return {
    policy: p,
    signature: await owner.signTypedData(browserQueryPolicyTypedData(p)),
  };
}
function leg(
  namespace: string,
  queryId: string,
  requestId = crypto.randomUUID(),
  selectedEpoch = epoch,
  sessionId = ownerId
): BrowserOriginalAdmission {
  const journal: BrowserJournalAdmission = {
    sessionId,
    requestId,
    queryId,
    grantEpoch: selectedEpoch,
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
      sourceName: "Source",
      payer: signer.address,
      payee,
      amountUsdc: 0.000001,
      network: "eip155:5042002",
      grantEpoch: selectedEpoch,
    },
  };
  return { queryNamespace: namespace, queryId, journal };
}
async function setup(v2 = true) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-signing-v2-")),
    file = path.join(folder, "fixture.sqlite");
  const db = new SqliteAdapter(file);
  await db.init();
  await db.upsertSessionGrant(grant());
  await db.activateBrowserJournal();
  const native = new DatabaseSync(file);
  native.exec("PRAGMA busy_timeout=5000");
  if (v2)
    native.exec("UPDATE browser_signing_v2_control SET active=1 WHERE id=1");
  fixtures.push({ db, native, folder });
  return { db, native, file };
}
async function query(db: SqliteAdapter, p = body(), sessionId = ownerId) {
  const approved = await proof(p),
    result = await db.admitBrowserQueryPolicy(approved, sessionId);
  if (result.status !== "admitted") throw new Error("Synthetic query refused");
  return { ...result, proof: approved };
}
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.native.close();
    fixture.db.close();
    fs.rmSync(fixture.folder, { recursive: true, force: true });
  }
});
it("installs inactive without changing v1 fresh behavior", async () => {
  const { db } = await setup(false),
    p = await proof();
  expect((await db.admitBrowserQueryPolicy(p, ownerId)).status).toBe(
    "inactive"
  );
  expect(
    (await db.admitBrowserJournal(leg("unused", p.policy.queryId).journal))
      .status
  ).toBe("admitted");
});
it("admits owner proof and complete original atomically with one payment debit", async () => {
  const { db, native } = await setup(),
    q = await query(db),
    input = leg(q.namespace, q.queryId);
  const admitted = await db.admitBrowserSigningOriginal(input);
  expect(admitted.status).toBe("admitted");
  expect((await db.getSessionGrant(ownerId))?.spent).toBe(0.000001);
  expect(
    native
      .prepare("SELECT allocated_micro,jobs FROM browser_signing_namespaces")
      .get()?.allocated_micro
  ).toBe(2);
  const snapshot = await db.readBrowserSigningSnapshot(
    ownerId,
    ownerId,
    input.journal.requestId
  );
  expect(snapshot?.original.authorization.nonce).toBe(snapshot?.journal.nonce);
  expect(snapshot?.query.spentMicros).toBe("1");
  expect(snapshot?.signerSpentMicros).toBe("1");
});
it("replays exact query and original without another allocation, nonce or debit", async () => {
  const { db, native } = await setup(),
    q = await query(db),
    input = leg(q.namespace, q.queryId);
  const first = await db.admitBrowserSigningOriginal(input);
  expect((await db.admitBrowserQueryPolicy(q.proof, ownerId)).status).toBe(
    "admitted"
  );
  const second = await db.admitBrowserSigningOriginal(input);
  expect(
    first.status === "admitted" &&
      second.status === "admitted" &&
      first.journal.nonce === second.journal.nonce
  ).toBe(true);
  expect(
    native.prepare("SELECT jobs FROM browser_signing_namespaces").get()?.jobs
  ).toBe(1);
  expect((await db.getSessionGrant(ownerId))?.spent).toBe(0.000001);
  expect(
    (
      await db.admitBrowserSigningOriginal({
        ...input,
        journal: {
          ...input.journal,
          requestId: input.journal.requestId,
          sourceId: "other",
          payment: { ...input.journal.payment, sourceId: "other" },
        },
      })
    ).status
  ).toBe("refused");
});
it("retains namespace jobs/allocation across new approvals and grant aliases", async () => {
  const { db, native } = await setup();
  await query(db);
  await query(db);
  expect(
    (await db.admitBrowserQueryPolicy(await proof(), ownerId)).status
  ).toBe("refused");
  const alias = "synthetic-alias",
    next = crypto.randomUUID();
  await db.upsertSessionGrant(grant(next, alias));
  expect(
    (
      await db.admitBrowserQueryPolicy(
        await proof(body({ grantEpoch: next })),
        alias
      )
    ).status
  ).toBe("refused");
  expect(
    native
      .prepare("SELECT jobs,allocated_micro FROM browser_signing_namespaces")
      .get()?.jobs
  ).toBe(2);
});
it("uses explicit absolute ceiling increases, refuses shrink, and verifies latest proof on old reads", async () => {
  const { db } = await setup(),
    q = await query(db),
    input = leg(q.namespace, q.queryId);
  await db.admitBrowserSigningOriginal(input);
  await query(db, body({ lifetimeCeilingMicros: "6", jobLimit: 3 }));
  const read = await db.readBrowserSigningSnapshot(
    ownerId,
    ownerId,
    input.journal.requestId
  );
  expect(read?.namespace.ceilingMicros).toBe("6");
  expect(read?.policy.policy.lifetimeCeilingMicros).toBe("4");
  expect(
    (
      await db.admitBrowserQueryPolicy(
        await proof(body({ lifetimeCeilingMicros: "2", jobLimit: 1 })),
        ownerId
      )
    ).status
  ).toBe("refused");
  expect(
    (
      await db.readBrowserSigningSnapshot(
        ownerId,
        ownerId,
        input.journal.requestId
      )
    )?.namespace.allocatedMicros
  ).toBe("4");
});
it("refuses wrong owner grant, stale query epoch and fractional economic tuple", async () => {
  const { db } = await setup(),
    q = await query(db),
    input = leg(q.namespace, q.queryId),
    next = crypto.randomUUID();
  await db.upsertSessionGrant(grant(next));
  expect((await db.admitBrowserSigningOriginal(input)).status).toBe("refused");
  const invalid = leg(q.namespace, q.queryId);
  invalid.journal.amountMicroUsdc = 0.5;
  await expect(db.admitBrowserSigningOriginal(invalid)).rejects.toThrow();
  const wrongOwnerEpoch = crypto.randomUUID();
  await db.upsertSessionGrant({
    ...grant(wrongOwnerEpoch),
    ownerAddr: signer.address,
  });
  expect(
    (
      await db.admitBrowserQueryPolicy(
        await proof(body({ grantEpoch: wrongOwnerEpoch })),
        ownerId
      )
    ).status
  ).toBe("refused");
});
it("query cap and monotonic spent guard refuse resets without touching originals", async () => {
  const { db, native } = await setup(),
    q = await query(db);
  await db.admitBrowserSigningOriginal(leg(q.namespace, q.queryId));
  await db.admitBrowserSigningOriginal(leg(q.namespace, q.queryId));
  expect(
    (await db.admitBrowserSigningOriginal(leg(q.namespace, q.queryId))).status
  ).toBe("refused");
  expect(() =>
    native.exec("UPDATE browser_signing_queries SET spent_micro=0")
  ).toThrow(/immutable/);
  expect((await db.getSessionGrant(ownerId))?.spent).toBe(0.000002);
});
it("sticky writer barrier survives reset/delete/reinstall of control", async () => {
  const { db, native } = await setup();
  for (const sql of [
    "UPDATE browser_signing_v2_control SET active=0",
    "DELETE FROM browser_signing_v2_control",
  ]) {
    native.exec(sql);
    initializeSqliteBrowserSigningOriginals(native);
    await expect(
      db.admitBrowserJournal(leg("unused", crypto.randomUUID()).journal)
    ).rejects.toThrow(/v2 writer/);
    expect(
      (await db.admitBrowserQueryPolicy(await proof(), ownerId)).status
    ).toBe("inactive");
  }
  expect(() =>
    native.exec("UPDATE browser_signing_v2_barrier SET ever_active=0")
  ).toThrow(/retained/);
});
it("shared insertion refuses calls outside the active journal writer transaction", async () => {
  const { native } = await setup(),
    input = leg("unused", crypto.randomUUID()).journal;
  expect(() =>
    admitSqliteBrowserJournalInTransaction(
      native,
      input,
      prepareBrowserJournal(input)
    )
  ).toThrow(/transaction/);
  expect(
    native
      .prepare("SELECT COUNT(*) AS n FROM browser_authorization_intents")
      .get()?.n
  ).toBe(0);
});
it("installer rollback leaves no partially installed capability, including inside caller transaction", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE browser_signing_v2_control(a,b,c); BEGIN");
    expect(() => initializeSqliteBrowserSigningOriginals(db)).toThrow();
    expect(db.isTransaction).toBe(true);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name='browser_signing_v2_barrier'"
        )
        .get()?.n
    ).toBe(0);
    db.exec("ROLLBACK");
  } finally {
    db.close();
  }
});
it("late canonical callback retains original metadata after epoch replacement with no read mutation", async () => {
  const { db, native } = await setup(),
    q = await query(db),
    input = leg(q.namespace, q.queryId),
    a = await db.admitBrowserSigningOriginal(input);
  if (a.status !== "admitted") throw new Error("Fixture refused");
  await db.exposeBrowserJournal(ownerId, input.journal.requestId);
  const header = serializeBrowserSigningHeader(
    a.original,
    await signer.signTypedData(browserSigningTypedData(a.original))
  );
  await db.upsertSessionGrant(grant(crypto.randomUUID()));
  const metadata = {
    validAfter: a.original.authorization.validAfter,
    validBefore: a.original.authorization.validBefore,
    headerHash: "11".repeat(32),
  };
  expect(
    await db.signBrowserJournal(ownerId, input.journal.requestId, metadata)
  ).toBe(false);
  expect(
    await db.signBrowserSigningOriginal(
      ownerId,
      input.journal.requestId,
      header
    )
  ).toBe(true);
  expect(
    await db.signBrowserSigningOriginal(
      ownerId,
      input.journal.requestId,
      header
    )
  ).toBe(true);
  expect(
    await db.signBrowserJournal(ownerId, input.journal.requestId, metadata)
  ).toBe(false);
  const before = native.prepare("SELECT * FROM browser_journal_bindings").all();
  await db.readBrowserSigningSnapshot(
    ownerId,
    ownerId,
    input.journal.requestId
  );
  expect(
    JSON.stringify(
      native.prepare("SELECT * FROM browser_journal_bindings").all()
    ) === JSON.stringify(before)
  ).toBe(true);
  expect((await db.getSessionGrant(ownerId))?.spent).toBe(0.000001);
});
it("snapshot captures immutable input before async proof recovery and rejects numeric counter coercion", async () => {
  const { db } = await setup(),
    q = await query(db),
    input = leg(q.namespace, q.queryId);
  await db.admitBrowserSigningOriginal(input);
  const original = await db.readBrowserSigningSnapshot(
    ownerId,
    ownerId,
    input.journal.requestId
  );
  if (!original) throw new Error("Fixture absent");
  const mutable = structuredClone(original),
    pending = validateBrowserSigningSnapshot(mutable, ownerId);
  mutable.policy.policy.queryCeilingMicros = "99";
  mutable.namespace.ceilingMicros = "99";
  const read = await pending;
  expect(read.query.ceilingMicros).toBe("2");
  expect(Object.isFrozen(read.policy.policy)).toBe(true);
  const malformed = structuredClone(original) as unknown as {
    signerSpentMicros: unknown;
  };
  malformed.signerSpentMicros = 1;
  await expect(
    validateBrowserSigningSnapshot(malformed as typeof original, ownerId)
  ).rejects.toThrow();
});
it("actual killed SQLite writer rolls back original markers and capacity changes", async () => {
  const { db, native, file } = await setup(),
    q = await query(db),
    input = leg(q.namespace, q.queryId);
  await db.admitBrowserSigningOriginal(input);
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import{DatabaseSync}from'node:sqlite';const d=new DatabaseSync(process.argv[1]);d.exec('BEGIN IMMEDIATE; INSERT INTO browser_journal_writer VALUES(1); INSERT INTO browser_signing_v2_writer VALUES(1); UPDATE browser_signing_queries SET spent_micro=spent_micro+1');process.stdout.write('POINT');setInterval(()=>{},1000);`,
      file,
    ],
    { stdio: ["ignore", "pipe", "ignore"] }
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Fixture timeout")),
        5000
      );
      child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error("Fixture unavailable"));
      });
    });
  } finally {
    child.kill("SIGKILL");
    if (child.exitCode === null && child.signalCode === null)
      await new Promise<void>((resolve) =>
        child.once("close", () => resolve())
      );
  }
  expect(
    native.prepare("SELECT COUNT(*) AS n FROM browser_journal_writer").get()?.n
  ).toBe(0);
  expect(
    native.prepare("SELECT COUNT(*) AS n FROM browser_signing_v2_writer").get()
      ?.n
  ).toBe(0);
  expect(
    (
      await db.readBrowserSigningSnapshot(
        ownerId,
        ownerId,
        input.journal.requestId
      )
    )?.query.spentMicros
  ).toBe("1");
}, 10000);

it("preserves historical legacy metadata callbacks after v2 installation", async () => {
  const { db, native } = await setup(false),
    input = leg("legacy", crypto.randomUUID());
  expect((await db.admitBrowserJournal(input.journal)).status).toBe("admitted");
  await db.exposeBrowserJournal(ownerId, input.journal.requestId);
  native.exec("UPDATE browser_signing_v2_control SET active=1 WHERE id=1");
  expect(
    await db.signBrowserJournal(ownerId, input.journal.requestId, {
      validAfter: "1",
      validBefore: "2000000000",
      headerHash: "22".repeat(32),
    })
  ).toBe(true);
});
it("serializes two actual process query admissions without resetting lifetime capacity", async () => {
  const { native, file } = await setup();
  const approved = await Promise.all([
    proof(body({ lifetimeCeilingMicros: "2", jobLimit: 1 })),
    proof(body({ lifetimeCeilingMicros: "2", jobLimit: 1 })),
  ]);
  const program = `import{createRequire}from'node:module';import{DatabaseSync}from'node:sqlite';const require=createRequire(import.meta.url);const {admitSqliteBrowserQueryPolicy}=require('./lib/db/sqlite-browser-signing-originals.ts');const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA busy_timeout=5000');process.stdout.write('READY\\n');let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',async()=>{try{const p=JSON.parse(data);const r=await admitSqliteBrowserQueryPolicy(d,p.proof,p.session);process.stdout.write(r.status);}catch{process.stdout.write('FAILED');process.exitCode=1;}finally{d.close();}});`;
  const children = approved.map(() =>
    spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", program, file],
      { cwd: process.cwd(), stdio: ["pipe", "pipe", "ignore"] }
    )
  );
  try {
    const ready = children.map(
      (child) =>
        new Promise<void>((resolve, reject) => {
          child.stdout.once("data", (chunk) =>
            String(chunk) === "READY\n"
              ? resolve()
              : reject(new Error("Fixture readiness refused"))
          );
          child.once("error", () => reject(new Error("Fixture unavailable")));
          child.once("close", () =>
            reject(new Error("Fixture exited before readiness"))
          );
        })
    );
    const outcomes = children.map(
      (child) =>
        new Promise<{ code: number | null; output: string }>((resolve) => {
          let output = "";
          child.stdout.on("data", (c) => (output += String(c)));
          child.once("close", (code) => resolve({ code, output }));
        })
    );
    const timer = setTimeout(
      () => children.forEach((c) => c.kill("SIGKILL")),
      10000
    );
    try {
      await Promise.all(ready);
      children.forEach((child, i) =>
        child.stdin.end(
          JSON.stringify({ proof: approved[i], session: ownerId })
        )
      );
      const results = await Promise.all(outcomes);
      expect(results.every((r) => r.code === 0)).toBe(true);
      expect(
        results.map((r) => r.output.replace("READY\n", "")).sort()
      ).toEqual(["admitted", "refused"]);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await Promise.all(
      children.map((child) =>
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              child.once("close", () => resolve());
              child.kill("SIGKILL");
            })
      )
    );
  }
  expect(
    native
      .prepare("SELECT allocated_micro,jobs FROM browser_signing_namespaces")
      .get()
  ).toMatchObject({ allocated_micro: 2, jobs: 1 });
  expect(
    native.prepare("SELECT COUNT(*) AS n FROM browser_signing_queries").get()?.n
  ).toBe(1);
}, 15000);

it("gates fresh v2 on base pause but retains historical canonical callbacks", async () => {
  const { db, native } = await setup(),
    q = await query(db),
    input = leg(q.namespace, q.queryId);
  const admitted = await db.admitBrowserSigningOriginal(input);
  if (admitted.status !== "admitted") throw new Error("Fixture refused");
  await db.exposeBrowserJournal(ownerId, input.journal.requestId);
  const header = serializeBrowserSigningHeader(
    admitted.original,
    await signer.signTypedData(browserSigningTypedData(admitted.original))
  );
  native.exec("UPDATE browser_journal_control SET active=0 WHERE id=1");
  expect(
    (await db.admitBrowserQueryPolicy(await proof(), ownerId)).status
  ).toBe("inactive");
  expect(
    (await db.admitBrowserSigningOriginal(leg(q.namespace, q.queryId))).status
  ).toBe("inactive");
  expect(
    (
      await db.readBrowserSigningSnapshot(
        ownerId,
        ownerId,
        input.journal.requestId
      )
    )?.active
  ).toBe(false);
  expect(
    await db.signBrowserSigningOriginal(
      ownerId,
      input.journal.requestId,
      header
    )
  ).toBe(true);
});
it("refuses expired owner proofs and ceilings beyond original grant without allocation", async () => {
  const { db, native } = await setup();
  expect(
    (
      await db.admitBrowserQueryPolicy(
        await proof(body({ expiresAt: Date.now() - 1 })),
        ownerId
      )
    ).status
  ).toBe("refused");
  expect(
    (
      await db.admitBrowserQueryPolicy(
        await proof(body({ lifetimeCeilingMicros: "11" })),
        ownerId
      )
    ).status
  ).toBe("refused");
  expect(
    (
      await db.admitBrowserQueryPolicy(
        await proof(body({ expiresAt: Date.now() + 300000 })),
        ownerId
      )
    ).status
  ).toBe("refused");
  expect(
    native.prepare("SELECT COUNT(*) AS n FROM browser_signing_queries").get()?.n
  ).toBe(0);
});

it("signer observation denies prepared and cancelled bytes while owner inspection remains unchanged", async () => {
  const { db, native, file } = await setup(),
    q = await query(db),
    input = leg(q.namespace, q.queryId);
  await db.admitBrowserSigningOriginal(input);
  for (const cancel of [false, true]) {
    if (cancel)
      await db.cancelPreparedBrowserJournal(ownerId, input.journal.requestId);
    native.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const bytes = fs.readFileSync(file),
      before = JSON.stringify(
        native.prepare("SELECT * FROM payment_events").all()
      );
    expect(
      await db.readExposedBrowserSigningSnapshotForSigner(
        signer.address,
        ownerId,
        input.journal.requestId
      )
    ).toBe(null);
    const owned = await db.readBrowserSigningSnapshot(
      ownerId,
      ownerId,
      input.journal.requestId
    );
    expect(owned !== null).toBe(true);
    expect(owned?.journal.phase).toBe(
      cancel ? "cancelled_unexposed" : "prepared"
    );
    expect(fs.readFileSync(file).equals(bytes)).toBe(true);
    expect(
      JSON.stringify(native.prepare("SELECT * FROM payment_events").all()) ===
        before
    ).toBe(true);
  }
});
it.each(["failed", "settled"])(
  "signer observation preserves exposed historical %s reads after revocation without mutations",
  async (status) => {
    const { db, native } = await setup(),
      q = await query(db),
      input = leg(q.namespace, q.queryId),
      admitted = await db.admitBrowserSigningOriginal(input);
    if (admitted.status !== "admitted") throw new Error("Fixture refused");
    await db.exposeBrowserJournal(ownerId, input.journal.requestId);
    expect(
      (
        await db.readExposedBrowserSigningSnapshotForSigner(
          signer.address,
          ownerId,
          input.journal.requestId
        )
      )?.journal.phase
    ).toBe("exposed");
    await db.deleteSessionGrant(ownerId);
    if (status === "failed")
      await db.failPendingPayment(
        admitted.journal.payment.id!,
        admitted.journal.nonce,
        "synthetic-terminal"
      );
    else
      await db.settlePendingPayment(
        admitted.journal.payment.id!,
        admitted.journal.nonce,
        "synthetic-terminal"
      );
    const before = JSON.stringify(
      native.prepare("SELECT * FROM payment_events").all()
    );
    const snapshot = await db.readExposedBrowserSigningSnapshotForSigner(
      signer.address,
      ownerId,
      input.journal.requestId
    );
    expect(snapshot?.journal.phase).toBe(status);
    expect(snapshot?.currentGrant?.expiry).toBe(0);
    expect(
      await db.readExposedBrowserSigningSnapshotForSigner(
        owner.address,
        ownerId,
        input.journal.requestId
      )
    ).toBe(null);
    expect(
      JSON.stringify(native.prepare("SELECT * FROM payment_events").all()) ===
        before
    ).toBe(true);
  }
);
