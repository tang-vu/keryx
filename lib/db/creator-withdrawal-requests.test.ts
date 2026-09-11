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
import { SqliteAdapter } from "./sqlite-adapter";
import { claimSupabaseWithdrawalTransfer, getSupabaseWithdrawalTransferClaim, reserveSupabaseWithdrawalRequest } from "./creator-withdrawal-requests";

const directory = mkdtempSync(join(tmpdir(), "keryx-creator-withdrawal-"));
const file = join(directory, "test.sqlite");
let db: SqliteAdapter, other: SqliteAdapter, raw: DatabaseSync;
beforeAll(async () => {
  db = new SqliteAdapter(file); other = new SqliteAdapter(file);
  await db.init(); await other.init(); raw = new DatabaseSync(file);
}, 60000);
afterAll(() => { db?.close(); other?.close(); raw?.close(); rmSync(directory, { recursive: true }); });
async function fixture() {
  const account = privateKeyToAccount(generatePrivateKey());
  const client = createWalletClient({ account, transport: custom({ request: async () => { throw new Error("RPC forbidden"); } }) });
  return createWithdrawalRequest(await buildAndSignWithdrawIntent(client, BigInt(50000)), {
    owner: account.address, recipient: account.address, domain: config.cctpDomain,
    gatewayWallet: config.gatewayWallet, gatewayMinter: config.gatewayMinter, asset: config.usdcAddress,
    maxValueMicros: "50000", maxFeeMicros: BigInt(Math.round(config.withdrawMaxFeeUsdc * 1e6)).toString(),
  });
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
