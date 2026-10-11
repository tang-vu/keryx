import { afterEach, describe, expect, it, vi } from "vitest";
import { preparePrivateRunClaim, privateRunClaimPacketSchema, privateRunClaimText } from "./delivery";
import { deliveryFixture } from "./delivery.test-fixture";
import { runClaimTokenHash } from "./service";
import { buildCompletion, keryxMeta } from "../openai-compat";
import { buildAnswerText as telegramAnswer } from "../telegram/ask-message";
const binding = { network: "eip155:5042002" as const, origin: "https://claims.example" };
const held: ReturnType<typeof deliveryFixture>[] = [];
const fixture = () => { const f = deliveryFixture(); held.push(f); return f; };
afterEach(() => { for (const f of held.splice(0)) f.sql.close(); vi.restoreAllMocks(); });
describe("private transport completion boundary", () => {
  it.each([{ enabled: false }, { enabled: true, owner: `0x${"a".repeat(40)}` }])("never opens storage for off/owned admission", async options => {
    const db = vi.fn(async () => { throw new Error("must stay unopened"); });
    expect(await preparePrivateRunClaim({ ...options, runId: "new", binding, db })).toBeNull(); expect(db).not.toHaveBeenCalled();
  });
  it("requires admitted storage before research and a real saved original before issuance", async () => {
    const research = vi.fn();
    await expect((async () => { await preparePrivateRunClaim({ enabled: true, runId: "new", binding, db: async () => ({}) }); research(); })())
      .rejects.toThrow(/^claims_unavailable$/); expect(research).not.toHaveBeenCalled();
    const f = fixture(), delivery = (await preparePrivateRunClaim({ enabled: true, runId: "new", binding, db: async () => f.db }))!;
    expect(await delivery.complete(f.run("new"))).toEqual({ version: 1, runId: "new", status: "unavailable" });
    expect(f.sql.prepare("SELECT * FROM anonymous_run_claims").all()).toEqual([]);
    f.save("new"); expect(await delivery.complete(f.run("new"))).toBeNull(); // No late mint/reissue.
  });
  it("delivers once after save, retains only hash, and leaves original and public projectors unchanged", async () => {
    const f = fixture(), delivery = (await preparePrivateRunClaim({ enabled: true, runId: "new", binding, db: async () => f.db }))!;
    const run = f.save("new"), original = JSON.stringify(run), publicValues = JSON.stringify([buildCompletion(run, "keryx"), keryxMeta(run), telegramAnswer(run)]);
    const packet = (await delivery.complete(run))!; expect(packet.status).toBe("available");
    if (packet.status !== "available") throw new Error("Expected private delivery");
    const token = new URL(packet.delivery.claimUrl).hash.slice(1), rows = f.sql.prepare("SELECT * FROM anonymous_run_claims").all();
    expect(rows).toHaveLength(1); expect(rows[0].token_hash).toBe(runClaimTokenHash(token, binding)); expect(JSON.stringify(rows)).not.toContain(token);
    expect(JSON.stringify(run)).toBe(original); expect(JSON.stringify([buildCompletion(run, "keryx"), keryxMeta(run), telegramAnswer(run)])).toBe(publicValues);
    expect(publicValues).not.toContain(token); expect(privateRunClaimText(packet)).toContain(packet.delivery.claimUrl);
    expect(await delivery.complete(run)).toBeNull(); expect(f.sql.prepare("SELECT * FROM anonymous_run_claims").all()).toHaveLength(1);
  });
  it("does not discard a saved answer or leak backend error bodies after a late issuance outage", async () => {
    const f = fixture(), delivery = (await preparePrivateRunClaim({ enabled: true, runId: "new", binding, db: async () => f.db }))!;
    const run = f.save("new"); vi.spyOn(f.store, "issue").mockRejectedValue(new Error("private-backend-response-body"));
    const packet = (await delivery.complete(run))!;
    expect(packet).toEqual({ version: 1, runId: "new", status: "unavailable" });
    expect(privateRunClaimText(packet)).not.toContain("private-backend-response-body");
    expect(f.sql.prepare("SELECT data FROM query_runs WHERE id='new'").get()?.data).toBe(JSON.stringify(run));
    expect(await delivery.complete(run)).toBeNull();
  });
  it("strict private packet grammar refuses extra selectors and archived/native run identifiers", () => {
    for (const value of [{ version: 1, runId: "new", status: "unavailable", token: "a".repeat(64) },
      { version: 1, runId: "prv_old", status: "unavailable" }, { version: 1, runId: "a2a_old", status: "unavailable" }])
      expect(privateRunClaimPacketSchema.safeParse(value).success).toBe(false);
  });
});
