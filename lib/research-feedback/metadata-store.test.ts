import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openRequesterOpinionStore } from "./metadata-store";
import { feedbackRowSchema } from "./contracts";
import { deliveredResearchDigest, requesterFeedbackId } from "./service";
import { recordedJobObservations } from "./observations";
import { binding, opinionFixture, recordedRun } from "./test-fixture";

const fixtures: ReturnType<typeof opinionFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
const fixture = () => { const f = opinionFixture(); fixtures.push(f); return f; };
const row = () => { const run = recordedRun(); return feedbackRowSchema.parse({ format: "keryx-requester-feedback-v1", runId: run.id,
  deliveredDigest: deliveredResearchDigest(run), choice: "revise", reason: "Need a concrete example", submittedAt: "2026-10-24T00:00:00.000Z", observations: recordedJobObservations(run) }); };

it("retains the first opinion and its original job observations across connections and restart", async () => {
  const f = fixture(), first = row();
  expect(await f.store.submit(first)).toEqual(first);
  const second = openRequesterOpinionStore(f.directory, binding);
  try {
    expect(second.storeId).toBe(f.store.storeId);
    expect(await second.submit({ ...first, choice: "useful", reason: "Changed", submittedAt: "2026-10-24T01:00:00.000Z" })).toEqual(first);
    expect(await second.read(requesterFeedbackId(first.runId, first.deliveredDigest))).toEqual(first);
  } finally { second.close(); }
  f.closeStore();
  const reopened = openRequesterOpinionStore(f.directory, binding);
  try { expect(await reopened.read(requesterFeedbackId(first.runId, first.deliveredDigest))).toEqual(first); } finally { reopened.close(); }
});

it("refuses another origin/network without changing the existing journal", () => {
  const f = fixture(), before = f.store.storeId;
  expect(() => openRequesterOpinionStore(f.directory, { ...binding, network: "eip155:5042" })).toThrow("feedback_unavailable");
  expect(() => openRequesterOpinionStore(f.directory, { ...binding, origin: "https://another.invalid" })).toThrow("feedback_unavailable");
  expect(f.store.storeId).toBe(before); f.store.assertAvailable();
});

it("refuses foreign metadata bytes before any repair, schema installation or write", () => {
  const f = fixture(); f.closeStore();
  const filename = join(f.directory, "requester-opinions.sqlite"), db = new DatabaseSync(filename);
  db.exec("CREATE TABLE foreign_owner_data(value TEXT); INSERT INTO foreign_owner_data VALUES('retain-original')"); db.close();
  chmodSync(filename, 0o600); const before = readFileSync(filename);
  expect(() => openRequesterOpinionStore(f.directory, binding)).toThrow("feedback_unavailable");
  expect(readFileSync(filename)).toEqual(before);
});

it("refuses mutable schema tampering on an already open journal", async () => {
  const f = fixture(), db = new DatabaseSync(join(f.directory, "requester-opinions.sqlite"));
  try { db.exec("DROP TRIGGER requester_opinions_no_update"); await expect(f.store.submit(row())).rejects.toThrow("feedback_unavailable"); }
  finally { db.close(); }
});
