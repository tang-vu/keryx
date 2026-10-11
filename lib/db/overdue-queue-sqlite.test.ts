import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SqliteAdapter } from "./sqlite-adapter";
import { syntheticA2aOriginal } from "./a2a-original-fixture";
import { paidJobEscalationQueue } from "../a2a/overdue-escalation-queue";

it("observes queued, started and failed originals through a physical readonly connection without hiding corrupt or capped rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "keryx-overdue-")), file = join(dir, "synthetic.sqlite");
  const writer = new SqliteAdapter(file);
  let reader: SqliteAdapter | undefined;
  let writerClosed = false;
  try {
    await writer.init();
    const orders = Array.from({ length: 6 }, (_, i) => ({ ...syntheticA2aOriginal(i + 1).order,
      createdAt: `2026-10-06T03:23:0${i}.000Z`, updatedAt: `2026-10-06T03:23:0${i}.000Z` }));
    orders[1] = { ...orders[1], status: "failed", errorCode: "research_failed" };
    orders[2] = { ...orders[2], startedAt: orders[2].createdAt };
    orders[5] = { ...orders[5], status: "completed" };
    for (const order of orders) await writer.createA2aOrder(order);
    writer.close();
    writerClosed = true;
    const native = new DatabaseSync(file);
    try {
      native.prepare("UPDATE a2a_orders SET package_data='corrupt' WHERE id=?").run(orders[3].id);
    } finally { native.close(); }
    const bytes = readFileSync(file);
    reader = new SqliteAdapter(file, { readOnly: true });
    expect(await reader.listUnfinishedA2aOrders(2)).toMatchObject({ orders: [orders[0], orders[1]], unreadable: 0, truncated: true });
    const read = await reader.listUnfinishedA2aOrders(5);
    expect(read.orders.map(order => order.id)).toEqual([orders[0].id, orders[1].id, orders[2].id, orders[4].id]);
    expect(read).toMatchObject({ unreadable: 1, truncated: false });
    const queue = await paidJobEscalationQueue(reader, Date.parse(orders[0].createdAt) + 185_000, 5);
    expect(queue).toMatchObject({ scanned: 5, unreadable: 1, attentionNeeded: true });
    expect(queue.overdue).toHaveLength(4);
    await expect(reader.listUnfinishedA2aOrders(501)).rejects.toThrow("invalid");
    expect(readFileSync(file)).toEqual(bytes);
  } finally {
    reader?.close(); if (!writerClosed) writer.close();
    rmSync(dir, { force: true, recursive: true });
  }
});
