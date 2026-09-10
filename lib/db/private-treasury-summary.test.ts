import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { getSqlitePrivateTreasurySummary } from "./private-treasury-summary";

it("keeps reserved, committed and confirmed amounts distinct without multiplying joins or mixing signers", async () => {
  const db = new DatabaseSync(":memory:"), signer = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`;
  try {
    db.exec(`CREATE TABLE private_treasury_pools(signer TEXT,capacity_micros INTEGER);
      CREATE TABLE private_treasury_reservations(job_id TEXT,signer TEXT,amount_micros INTEGER);
      CREATE TABLE private_creator_submissions(job_id TEXT,authorization_id TEXT,amount_micros INTEGER,data TEXT);
      CREATE TABLE private_creator_confirmations(authorization_id TEXT,data TEXT);`);
    expect(await getSqlitePrivateTreasurySummary(db, signer)).toBeNull();
    db.prepare("INSERT INTO private_treasury_pools VALUES(?,100000)").run(signer);
    expect(await getSqlitePrivateTreasurySummary(db, signer)).toMatchObject({ allocatedMicros: "0", conservativeBackingMicros: "100000" });
    for (const [id, owner, amount] of [["one", signer, 60000], ["two", signer, 20000], ["other", other, 40000]] as const)
      db.prepare("INSERT INTO private_treasury_reservations VALUES(?,?,?)").run(id, owner, amount);
    for (const [id, owner, amount, status] of [["one", signer, 10000, "facilitator"], ["one", signer, 5000, "received"],
      ["two", signer, 7000, "unresolved"], ["two", signer, 8000, "completed"], ["other", other, 40000, "facilitator"]] as const) {
      const key = `${id}-${amount}`, submission = { amountMicros: String(amount), payer: owner };
      db.prepare("INSERT INTO private_creator_submissions VALUES(?,?,?,?)").run(id, key, amount, JSON.stringify({ submission }));
      if (status !== "unresolved") db.prepare("INSERT INTO private_creator_confirmations VALUES(?,?)").run(key,
        JSON.stringify({ submission, source: status === "facilitator" ? "circle-facilitator-success" : "circle-transfer-search", transferStatus: status }));
    }
    expect(await getSqlitePrivateTreasurySummary(db, signer)).toEqual({ capacityMicros: "100000", allocatedMicros: "80000",
      unallocatedMicros: "20000", committedMicros: "30000", confirmedMicros: "18000", unresolvedOrProcessingMicros: "12000",
      conservativeBackingMicros: "82000", observation: "database-recorded", chainFinalityVerified: false });
    db.prepare("UPDATE private_creator_confirmations SET data=json_set(data,'$.transferStatus','confirmed') WHERE authorization_id=?").run("one-5000");
    expect(await getSqlitePrivateTreasurySummary(db, signer)).toMatchObject({ confirmedMicros: "23000", conservativeBackingMicros: "77000" });
    db.prepare("UPDATE private_creator_confirmations SET data=json_set(data,'$.submission.amountMicros','999') WHERE authorization_id=?").run("one-5000");
    await expect(getSqlitePrivateTreasurySummary(db, signer)).rejects.toThrow("accounting mismatch");
  } finally { db.close(); }
});
