import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { createOperatorTask } from "../../lib/operator/task";
import { WorkspaceStore } from "./workspace";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function temp() { const path = await mkdtemp(join(tmpdir(), "keryx-desktop-test-")); roots.push(path); return path; }
const input = { question: "What changed in Arc research this week?", mode: "quick" as const,
  creatorBudget: "0.01", totalCap: "0.10", payee: "0x1111111111111111111111111111111111111111" };

it("creates multiple real tasks and lists a CLI-created task after reopening", async () => {
  const workspace = await temp();
  const store = new WorkspaceStore();
  await store.select(workspace);
  const a = await store.createTask(input);
  const b = await store.createTask({ ...input, question: "Second research task" });
  expect(a.handle).not.toBe(b.handle);
  expect((await store.view()).tasks).toHaveLength(2);
  await createOperatorTask(join(workspace, "cli-task-1"), { request: {
    question: "Created by CLI", budget: 0.01, researchMode: "deep", packageVersion: "1.0.0", responseMode: "async",
  }, payee: input.payee, maxTotalMicros: "100000" });
  const relaunched = new WorkspaceStore();
  const view = await relaunched.select(workspace);
  expect(view.tasks.map(task => task.question)).toContain("Created by CLI");
  expect(view.tasks).toHaveLength(3);
  expect(view.tasks.every(task => task.status.payment === "unknown" && task.status.delivery === "unknown")).toBe(true);
  expect(JSON.parse(await relaunched.exportTask(view.tasks[0].handle)).schema).toBe("keryx-operator-task-status-v1");
  await expect(relaunched.resumeTask(view.tasks[0].handle)).rejects.toThrow(/No complete buyer journal/);
});

it("keeps bounded immutable reference bytes with hash and rejects symlink/oversize inputs", async () => {
  const root = await temp(); const workspace = join(root, "workspace"); await mkdir(workspace);
  const source = join(root, "note.md"); const content = Buffer.from("# Provenance\nResearch note\n"); await writeFile(source, content);
  const store = new WorkspaceStore(); await store.select(workspace);
  const imported = await store.importReference(source);
  expect(imported.sha256).toBe(createHash("sha256").update(content).digest("hex"));
  await writeFile(source, "changed later");
  expect(await readFile(join(workspace, "references", `${imported.handle}.txt`))).toEqual(content);
  expect((await store.references())[0].name).toBe("note.md");
  const link = join(root, "link.md");
  try { await symlink(source, link); await expect(store.importReference(link)).rejects.toThrow(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; }
  const large = join(root, "large.txt"); await writeFile(large, Buffer.alloc(262145, 65));
  await expect(store.importReference(large)).rejects.toThrow(/too large/);
});

it("does not follow replaced workspace roots or oversized adjacent buyer journals", async () => {
  const root = await temp(); const workspace = join(root, "workspace"); const alternate = join(root, "alternate");
  await mkdir(workspace); await mkdir(alternate);
  const store = new WorkspaceStore(); await store.select(workspace);
  const task = await store.createTask(input);
  const buyer = join(workspace, task.directoryName, "buyer"); await mkdir(buyer);
  await writeFile(join(buyer, "intent.json"), Buffer.alloc(65537, 65));
  expect((await store.view()).invalidDirectories).toBe(1);
  await rm(workspace, { recursive: true }); await symlink(alternate, workspace, "junction");
  await expect(store.createTask(input)).rejects.toThrow(/workspace has changed/);
});
