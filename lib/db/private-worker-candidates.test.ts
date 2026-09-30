import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { listSqlitePrivateWorkerCandidates } from "./private-worker-candidates";
import { sqliteDomainTestFixtures } from "./sqlite-domain-test-fixture";
const sqliteFixtures=sqliteDomainTestFixtures();

it("bounds and pages candidate hints while excluding pending, claimed and other-signer rows", async () => {
  const fixture=await sqliteFixtures.raw("testnet-real"),db=fixture.db;
  const signer = `0x${"a".repeat(40)}`, payer = `0x${"b".repeat(40)}`;
  const id = (n: number) => `prv_${n.toString(16).padStart(64, "0")}`;
  try {
    // Minimal relational fixtures test selection only, never signature or payment validity.
    db.exec(`CREATE TABLE private_research_intents(id TEXT,payer TEXT,data TEXT);
      CREATE TABLE private_treasury_reservations(job_id TEXT,signer TEXT);
      CREATE TABLE private_research_payment_attempts(id TEXT,confirmation TEXT,settled_at TEXT);
      CREATE TABLE private_research_executions(id TEXT);`);
    fixture.fence();
    const metadata=JSON.stringify({requirement:{network:"eip155:5042002",asset:"0x3600000000000000000000000000000000000000",extra:{name:"GatewayWalletBatched",version:"1",verifyingContract:"0x0077777d7EBA4688BDeF3E311b846F25870A19B9"}}});
    for (let n = 1; n <= 30; n++) {
      db.prepare("INSERT INTO private_research_intents VALUES(?,?,?)").run(id(n), payer,metadata);
      db.prepare("INSERT INTO private_treasury_reservations VALUES(?,?)").run(id(n), n === 30 ? payer : signer);
      db.prepare("INSERT INTO private_research_payment_attempts VALUES(?,?,?)").run(id(n), n === 29 ? null : "synthetic", n === 29 ? null : "synthetic");
    }
    db.prepare("INSERT INTO private_research_executions VALUES(?)").run(id(28));
    const first = await listSqlitePrivateWorkerCandidates(db, signer.toUpperCase().replace("0X", "0x"));
    expect(first).toEqual(Array.from({ length: 25 }, (_, n) => ({ id: id(n+1), payer })));
    expect(await listSqlitePrivateWorkerCandidates(db, signer, first[24].id)).toEqual([{ id: id(26), payer }, { id: id(27), payer }]);
    await expect(listSqlitePrivateWorkerCandidates(db, signer, "invalid")).rejects.toThrow();
  } finally { db.close(); }
});
