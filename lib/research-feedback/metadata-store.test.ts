import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
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

it("keeps one original opinion when separate processes race different choices", async () => {
  const f = fixture(), original = row();
  const contenders = ["useful", "reject"].map(choice => {
    const input = { ...original, choice, reason: `Concurrent ${choice}` };
    const code = `import {openRequesterOpinionStore} from ${JSON.stringify(new URL("./metadata-store.ts", import.meta.url).href)};
      const store=openRequesterOpinionStore(${JSON.stringify(f.directory)},${JSON.stringify(binding)});
      const go=new Promise(resolve=>process.stdin.once('data',resolve));console.log('ready');await go;
      try{console.log(JSON.stringify({ok:true,row:await store.submit(${JSON.stringify(input)})}));}
      catch(error){console.log(JSON.stringify({ok:false,error:error.message}));}finally{store.close();}`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], { cwd: process.cwd(), windowsHide: true });
    let output = "", acknowledge: () => void, refuse: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { acknowledge = resolve; refuse = reject; });
    child.stdout.on("data", bytes => { output += String(bytes); if (output.includes("ready\n") || output.includes("ready\r\n")) acknowledge(); });
    child.stderr.resume();
    const done = new Promise<{ ok: boolean; row?: typeof original; error?: string }>((resolve, reject) => {
      child.once("error", error => { refuse(error); reject(error); });
      child.once("close", code => {
        if (code !== 0) { const error = new Error("Concurrent fixture child failed"); refuse(error); reject(error); return; }
        try { resolve(JSON.parse(output.trim().split(/\r?\n/).at(-1)!)); } catch (error) { reject(error); }
      });
    });
    void done.catch(() => {});
    return { child, ready, done };
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async () => {
      await Promise.all(contenders.map(value => value.ready));
      for (const value of contenders) value.child.stdin.end("go");
      const results = await Promise.all(contenders.map(value => value.done));
      const final = await f.store.read(requesterFeedbackId(original.runId, original.deliveredDigest));
      expect(final).not.toBeNull(); expect(["useful", "reject"]).toContain(final!.choice);
      expect(results.some(value => value.ok)).toBe(true);
      for (const result of results) {
        if (result.ok) expect(result.row).toEqual(final);
        else expect(result.error).toBe("feedback_unavailable");
      }
      const probe = new DatabaseSync(join(f.directory, "requester-opinions.sqlite"), { readOnly: true });
      try { expect(probe.prepare("SELECT count(*) AS n FROM requester_opinions").get()?.n).toBe(1); } finally { probe.close(); }
    };
    await Promise.race([work(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Concurrent fixture deadline")), 25000); })]);
  } finally {
    clearTimeout(timeout);
    for (const value of contenders) if (value.child.exitCode === null) value.child.kill();
  }
}, 30000);
