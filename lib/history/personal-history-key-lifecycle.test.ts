import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { createHistoryRoute } from "./personal-history-route";
const owner = `0x${"a".repeat(40)}`, foreign = `0x${"b".repeat(40)}`, raw = `kx_live_${"1".repeat(96)}`;
it("ordinary SQLite key revocation and foreign-owner revoke retain the actual history auth boundary", async () => {
  const db = new SqliteAdapter(":memory:"); await db.init();
  try {
    const digest = createHash("sha256").update(raw).digest("hex"), prefix = raw.slice(0, 16);
    const minted = await db.mintApiKey(owner, prefix, digest, "synthetic-history-only", "history:read");
    let sessions = 0;
    const route = createHistoryRoute({ db: async () => db, network: "eip155:5042002", session: async () => { sessions++; return { db, wallet: foreign }; },
      key: async value => db.verifyApiKey(value.slice(0, 16), createHash("sha256").update(value).digest("hex")) });
    const request = () => new Request("https://synthetic.example/api/me/history", { headers: { Authorization: `Bearer ${raw}` } });
    expect((await route(request())).status).toBe(200);
    await db.revokeApiKey(minted.id, foreign); expect((await route(request())).status).toBe(200);
    await db.revokeApiKey(minted.id, owner); expect((await route(request())).status).toBe(401); expect(sessions).toBe(0);
    expect(await db.listQueryRunsByAsker(owner, 10)).toEqual([]);
  } finally { db.close(); }
});
