/** Anonymized synthetic bookkeeping. This fixture is not a funded or vendor-settled job. */
import { SqliteAdapter } from "../db/sqlite-adapter";
import { seedSyntheticA2aOriginal } from "../db/a2a-original-fixture";
import type { AcceptanceInput } from "./contracts";
export async function acceptanceFixture(file = ":memory:") {
  const db = new SqliteAdapter(file); await db.init();
  const fixture = await seedSyntheticA2aOriginal(db);
  const { order, binding } = fixture;
  await db.completeA2aOrder(order.id, { status: "completed", queryId: order.id, answer: "Synthetic delivered answer 😀", researchPackage: order.researchPackage }, "2026-10-09T00:00:00.000Z");
  const key = await db.mintApiKey(order.payer, "synthetic-acceptance", "synthetic-no-secret", "synthetic", "deliverable:read,deliverable:write");
  const authority = { kind: "api-key" as const, id: key.id };
  const port = db.deliverableAcceptance!;
  const snapshot = await port.read(order.payer, binding.network, order.id);
  const input: AcceptanceInput = { originalFingerprint: snapshot.originalFingerprint, deliveredDigest: snapshot.deliveredDigest,
    expectedRevision: 0, idempotencyKey: "synthetic-request-0001", choice: "accept", reason: "", publishState: false };
  return { db, fixture, authority, port, snapshot, input };
}
