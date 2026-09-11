import { listSupabaseWithdrawalHistory } from "./creator-withdrawal-history";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@supabase/supabase-js";
import { createWalletClient, custom } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, expect, it } from "vitest";
import { config } from "../config";
import { buildAndSignWithdrawIntent } from "../gateway/withdraw-intent";
import { createWithdrawalRequest } from "../gateway/withdrawal-request";
import { withdrawTypedData } from "../gateway/withdraw-protocol";
import { SqliteAdapter } from "./sqlite-adapter";
import { claimSupabaseWithdrawalTransfer, getSupabaseWithdrawalTransferClaim, reserveSupabaseWithdrawalRequest } from "./creator-withdrawal-requests";
import { getSupabaseWithdrawalAttestation, saveSupabaseWithdrawalAttestation } from "./creator-withdrawal-attestations";

const directory = mkdtempSync(join(tmpdir(), "keryx-creator-withdrawal-"));
const file = join(directory, "test.sqlite");
let db: SqliteAdapter, other: SqliteAdapter, raw: DatabaseSync;
beforeAll(async () => {
  db = new SqliteAdapter(file); other = new SqliteAdapter(file);
  await db.init(); await other.init(); raw = new DatabaseSync(file);
}, 60000);
afterAll(() => { db?.close(); other?.close(); raw?.close(); rmSync(directory, { recursive: true }); });
async function fixture(account = privateKeyToAccount(generatePrivateKey())) {
  const client = createWalletClient({ account, transport: custom({ request: async () => { throw new Error("RPC forbidden"); } }) });
  return createWithdrawalRequest(await buildAndSignWithdrawIntent(client, BigInt(50000)), {
    owner: account.address, recipient: account.address, domain: config.cctpDomain,
    gatewayWallet: config.gatewayWallet, gatewayMinter: config.gatewayMinter, asset: config.usdcAddress,
    maxValueMicros: "50000", maxFeeMicros: BigInt(Math.round(config.withdrawMaxFeeUsdc * 1e6)).toString(),
  });
}

function responseFor(record: Awaited<ReturnType<typeof fixture>>) {
  const s = record.request.burnIntent.spec;
  const spec = "ca85def7000000010000001a0000001a" +
    [s.sourceContract,s.destinationContract,s.sourceToken,s.destinationToken,s.sourceDepositor,
      s.destinationRecipient,s.sourceSigner,s.destinationCaller].map(value => value.slice(2)).join("") +
    BigInt(s.value).toString(16).padStart(64,"0") + s.salt.slice(2) + "00000000";
  return { transferId: randomUUID(), attestation: `0xff6fb334${BigInt(10000).toString(16).padStart(64,"0")}00000154${spec}`,
    signature: `0x${"12".repeat(65)}`, expirationBlock: "10000" };
}

it("persists the exact request and gives only one caller initial transfer authority across connections/restart", async () => {
  const record = await fixture();
  expect(await Promise.all([db.reserveCreatorWithdrawal(record), other.reserveCreatorWithdrawal(record)])).toEqual([record, record]);
  const claims = await Promise.all([db.claimCreatorWithdrawalTransfer(record.id, record.owner), other.claimCreatorWithdrawalTransfer(record.id, record.owner)]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const original = claims.find(Boolean)!;
  const reopened = new SqliteAdapter(file); await reopened.init();
  try {
    expect(await reopened.getCreatorWithdrawal(record.id, record.owner)).toEqual(record);
    expect(await reopened.getCreatorWithdrawalTransferClaim(record.id, record.owner)).toEqual(original);
    expect(await reopened.claimCreatorWithdrawalTransfer(record.id, record.owner)).toBeNull();
    expect(await reopened.listWithdrawals(10)).toEqual([]);
  } finally { reopened.close(); }
}, 60000);

it("denies foreign ownership, changed policy and mutations of request/attempt barriers", async () => {
  const record = await fixture(); await db.reserveCreatorWithdrawal(record);
  const foreign = privateKeyToAccount(generatePrivateKey()).address;
  expect(await db.getCreatorWithdrawal(record.id, foreign)).toBeNull();
  expect(await db.getCreatorWithdrawalTransferClaim(record.id, foreign)).toBeNull();
  await expect(db.claimCreatorWithdrawalTransfer(record.id, foreign)).rejects.toThrow("authority");
  await expect(db.reserveCreatorWithdrawal({ ...record, policy: { ...record.policy, maxValueMicros: "50001" } })).rejects.toThrow("conflict");
  await db.claimCreatorWithdrawalTransfer(record.id, record.owner);
  for (const table of ["creator_withdrawal_requests", "creator_withdrawal_transfer_attempts"]) {
    expect(() => raw.prepare(`DELETE FROM ${table} WHERE id=?`).run(record.id)).toThrow("immutable");
    expect(() => raw.prepare(`UPDATE ${table} SET id=id WHERE id=?`).run(record.id)).toThrow("immutable");
  }
  expect(await db.getCreatorWithdrawal(record.id, record.owner)).toEqual(record);
});

it("refuses inconsistent stored identity and signatures before granting transfer authority", async () => {
  const record = await fixture(), id = `0x${"78".repeat(32)}`;
  raw.prepare("INSERT INTO creator_withdrawal_requests(id,owner,data) VALUES(?,?,?)").run(id, record.owner, JSON.stringify(record));
  await expect(db.claimCreatorWithdrawalTransfer(id, record.owner)).rejects.toThrow("unavailable");
  const altered = structuredClone(record); altered.request.burnIntent.spec.value = "49999";
  await expect(db.reserveCreatorWithdrawal(altered)).rejects.toThrow("unavailable");
  expect(raw.prepare("SELECT count(*) AS n FROM creator_withdrawal_transfer_attempts WHERE id=?").get(id)?.n).toBe(0);
});

it("denies a new signed fee/expiry authorization for the same underlying transfer spec", async () => {
  const account = privateKeyToAccount(generatePrivateKey()), record = await fixture(account);
  await db.reserveCreatorWithdrawal(record);
  const changed = structuredClone(record.request); changed.burnIntent.maxBlockHeight = "10000";
  changed.signature = await account.signTypedData(withdrawTypedData(changed.burnIntent));
  const replacement = await createWithdrawalRequest(changed, record.policy);
  expect(replacement.id).not.toBe(record.id);
  await expect(other.reserveCreatorWithdrawal(replacement)).rejects.toThrow();
  expect(await other.getCreatorWithdrawal(replacement.id, record.owner)).toBeNull();
  expect(await db.getCreatorWithdrawal(record.id, record.owner)).toEqual(record);
});

it("keeps a committed Supabase claim after response loss and rejects wrong claim readback", async () => {
  let target = await fixture(), loseResponse = true, corruptReadback = false;
  const allowed = new Set(["creator_withdrawal_requests", "creator_withdrawal_transfer_attempts"]);
  const client = createClient("https://synthetic.invalid", "no-authority", { auth: { persistSession: false }, global: { fetch: async (url, options) => {
    const route = new URL(String(url)), name = route.pathname.split("/").at(-1)!;
    if (route.pathname.includes("/rpc/")) {
      const body = JSON.parse(String(options?.body));
      expect(body.p_id).toBe(target.id); expect(body.p_owner).toBe(target.owner);
      if (name === "reserve_creator_withdrawal") {
        await db.reserveCreatorWithdrawal(body.p_data); return new Response(null, { status: 204 });
      }
      if (name !== "claim_creator_withdrawal_transfer") throw new Error("Unexpected RPC");
      // Model the actual SQL CAS with the supplied claim token, not a newly generated one.
      const added = raw.prepare(`INSERT INTO creator_withdrawal_transfer_attempts(id,claim_id)
        SELECT id,? FROM creator_withdrawal_requests WHERE id=? AND owner=? ON CONFLICT(id) DO NOTHING`)
        .run(body.p_claim_id, body.p_id, body.p_owner).changes === 1;
      if (loseResponse) { loseResponse = false; return new Response("{}", { status: 503 }); }
      return Response.json(added);
    }
    if (!allowed.has(name) || options?.method !== "GET") throw new Error("Unexpected transport");
    expect(route.searchParams.get("id")).toBe(`eq.${target.id}`);
    const rows = raw.prepare(`SELECT * FROM ${name} WHERE id=?`).all(target.id).map(row => ({ ...row,
      ...(typeof row.data === "string" ? { data: JSON.parse(row.data) } : {}),
      ...(corruptReadback && name === "creator_withdrawal_transfer_attempts" ? { claim_id: randomUUID() } : {}),
    }));
    return Response.json(rows);
  } } });
  expect(await reserveSupabaseWithdrawalRequest(client, target)).toEqual(target);
  await expect(claimSupabaseWithdrawalTransfer(client, target.id, target.owner)).rejects.toThrow("unavailable");
  const original = await db.getCreatorWithdrawalTransferClaim(target.id, target.owner);
  expect(original).not.toBeNull();
  expect(await claimSupabaseWithdrawalTransfer(client, target.id, target.owner)).toBeNull();
  expect(await getSupabaseWithdrawalTransferClaim(client, target.id, target.owner)).toEqual(original);
  target = await fixture(); await reserveSupabaseWithdrawalRequest(client, target); corruptReadback = true;
  await expect(claimSupabaseWithdrawalTransfer(client, target.id, target.owner)).rejects.toThrow("unavailable");
  expect(await db.claimCreatorWithdrawalTransfer(target.id, target.owner)).toBeNull();
});

it("persists only the original request-matched attestation under its transfer claim, without granting mint authority", async () => {
  const record = await fixture(), response = responseFor(record);
  await db.reserveCreatorWithdrawal(record);
  await expect(db.saveCreatorWithdrawalAttestation(record.id, record.owner, randomUUID(), response)).rejects.toThrow("authority");
  const claim = (await db.claimCreatorWithdrawalTransfer(record.id, record.owner))!;
  const foreign = privateKeyToAccount(generatePrivateKey()).address;
  await expect(db.saveCreatorWithdrawalAttestation(record.id, foreign, claim.claimId, response)).rejects.toThrow("authority");
  await expect(db.saveCreatorWithdrawalAttestation(record.id, record.owner, randomUUID(), response)).rejects.toThrow("authority");
  const results = await Promise.all([db, other].map(store => store.saveCreatorWithdrawalAttestation(record.id, record.owner, claim.claimId, response)));
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({ authority: "request-matched-only", requestId: record.id, transferId: response.transferId });
  const reopened = new SqliteAdapter(file); await reopened.init();
  try {
    expect(await reopened.getCreatorWithdrawalAttestation(record.id, record.owner)).toEqual(results[0]);
    expect(await reopened.getCreatorWithdrawalAttestation(record.id, foreign)).toBeNull();
    expect(await reopened.claimCreatorWithdrawalTransfer(record.id, record.owner)).toBeNull();
    await expect(reopened.saveCreatorWithdrawalAttestation(record.id, record.owner, claim.claimId,
      { ...response, transferId: randomUUID() })).rejects.toThrow("conflict");
    expect(await reopened.listWithdrawals(10)).toEqual([]);
  } finally { reopened.close(); }
  expect(() => raw.prepare("UPDATE creator_withdrawal_attestations SET data='{}' WHERE id=?").run(record.id)).toThrow("immutable");
  expect(() => raw.prepare("DELETE FROM creator_withdrawal_attestations WHERE id=?").run(record.id)).toThrow("immutable");
}, 60000);

it("recovers an attestation storage response loss and rejects corrupted Supabase readback", async () => {
  const record = await fixture(), response = responseFor(record);
  await db.reserveCreatorWithdrawal(record);
  const claim = (await db.claimCreatorWithdrawalTransfer(record.id, record.owner))!;
  let loseResponse = true, corrupt = false;
  const allowed = new Set(["creator_withdrawal_requests", "creator_withdrawal_transfer_attempts", "creator_withdrawal_attestations"]);
  const client = createClient("https://synthetic.invalid", "no-authority", { auth: { persistSession: false }, global: { fetch: async (url, options) => {
    const route = new URL(String(url)), name = route.pathname.split("/").at(-1)!;
    if (route.pathname.endsWith("/rpc/save_creator_withdrawal_attestation")) {
      const body = JSON.parse(String(options?.body));
      expect(body.p_id).toBe(record.id); expect(body.p_owner).toBe(record.owner);
      expect(body.p_claim_id).toBe(claim.claimId); expect(body.p_transfer_id).toBe(response.transferId);
      await db.saveCreatorWithdrawalAttestation(record.id, record.owner, claim.claimId, body.p_data);
      if (loseResponse) { loseResponse = false; return new Response("{}", { status: 503 }); }
      return new Response(null, { status: 204 });
    }
    if (!allowed.has(name) || options?.method !== "GET") throw new Error("Unexpected transport");
    expect(route.searchParams.get("id")).toBe(`eq.${record.id}`);
    const rows = raw.prepare(`SELECT * FROM ${name} WHERE id=?`).all(record.id).map(row => ({ ...row,
      ...(typeof row.data === "string" ? { data: JSON.parse(row.data) } : {}),
      ...(corrupt && name === "creator_withdrawal_attestations" ? { transfer_id: randomUUID() } : {}),
    }));
    return Response.json(rows);
  } } });
  const save = () => saveSupabaseWithdrawalAttestation(client, record.id, record.owner, claim.claimId, response);
  await expect(save()).rejects.toThrow("unavailable");
  const original = await db.getCreatorWithdrawalAttestation(record.id, record.owner);
  expect(await save()).toEqual(original);
  corrupt = true;
  await expect(getSupabaseWithdrawalAttestation(client, record.id, record.owner)).rejects.toThrow("unavailable");
  expect(await db.getCreatorWithdrawalTransferClaim(record.id, record.owner)).toEqual(claim);
  expect(raw.prepare("SELECT count(*) AS n FROM creator_withdrawal_attestations WHERE id=?").get(record.id)?.n).toBe(1);
});


it("lists only the owner's signed requests with stable equal-time pagination and no bearer payload", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const records = await Promise.all([fixture(account), fixture(account), fixture(account)]);
  const foreign = await fixture();
  const ordered = records.slice(0, 2).sort((a, b) => a.id < b.id ? 1 : -1);
  for (const [index, record] of [...records, foreign].entries()) {
    raw.prepare("INSERT INTO creator_withdrawal_requests(id,owner,data,created_at) VALUES(?,?,?,?)")
      .run(record.id, record.owner, JSON.stringify(record), index < 2 ? "2026-09-11T01:00:00.000Z" : "2026-09-10T01:00:00.000Z");
  }
  const first = await db.listCreatorWithdrawalHistory(account.address, undefined, 1);
  expect(first.requests.map(row => row.id)).toEqual([ordered[0].id]);
  const second = await db.listCreatorWithdrawalHistory(account.address, first.nextCursor!, 1);
  expect(second.requests.map(row => row.id)).toEqual([ordered[1].id]);
  const third = await db.listCreatorWithdrawalHistory(account.address, second.nextCursor!, 1);
  expect(third.requests.map(row => row.id)).toEqual([records[2].id]); expect(third.nextCursor).toBeNull();
  expect(Object.keys(first.requests[0]).sort()).toEqual(["amountMicros", "createdAt", "id", "maxFeeMicros", "owner", "recipient"]);
  expect(JSON.stringify(first)).not.toContain(records[0].request.signature);
  await expect(db.listCreatorWithdrawalHistory(account.address, undefined, 26)).rejects.toThrow();
});

it("binds real Supabase query construction to owner, timestamp/id cursor and bounded limit", async () => {
  const record = await fixture(), createdAt = "2026-09-11T01:00:00.123456+00:00";
  let calls = 0, returned = record;
  const sb = createClient("https://history.invalid", "synthetic-test-key", { global: { fetch: async (input) => {
    calls++; const url = new URL(String(input));
    expect(url.searchParams.get("owner")).toBe(`eq.${record.owner}`);
    expect(url.searchParams.get("order")).toBe("created_at.desc,id.desc"); expect(url.searchParams.get("limit")).toBe("2");
    expect(url.searchParams.get("or")).toBe(`(created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${record.id}))`);
    return Response.json([{ id: returned.id, owner: returned.owner, created_at: createdAt, data: returned }]);
  } } });
  const cursor = { createdAt, id: record.id };
  const page = await listSupabaseWithdrawalHistory(sb, record.owner, cursor, 1);
  expect(page.requests[0].amountMicros).toBe("50000");
  returned = await fixture();
  await expect(listSupabaseWithdrawalHistory(sb, record.owner, cursor, 1)).rejects.toThrow();
  const before = calls;
  await expect(listSupabaseWithdrawalHistory(sb, record.owner, { ...cursor, createdAt: "x),owner.neq.x" }, 1)).rejects.toThrow();
  expect(calls).toBe(before);
});
