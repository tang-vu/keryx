import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { creationError, WorkspaceStore, type DesktopTaskWriter } from "./workspace";
import { boundErrorMessage, MAX_ERROR_BYTES } from "./helper-protocol";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function temp() { const path = await mkdtemp(join(tmpdir(), "keryx-desktop-test-")); roots.push(path); return path; }
const input = { question: "What changed in Arc research this week?", mode: "quick" as const,
  creatorBudget: "0.01", totalCap: "0.10", payee: "0x1111111111111111111111111111111111111111" };
const writer: DesktopTaskWriter = {
  async create({ parent, child, request, payee, maxTotalMicros, id, createdAt, network }) {
    const target = join(parent, child);
    await mkdir(target);
    await writeFile(join(target, "request.json"), JSON.stringify(request) + "\n");
    await writeFile(join(target, "task.json"), JSON.stringify({ schema: network === "eip155:5042" ? "keryx-operator-task-v2" : "keryx-operator-task-v1", ...(network === "eip155:5042" ? { network } : {}), id,
      createdAt, kind: "paid_research", request, payee, maxTotalMicros }) + "\n");
    return { taskId: id, child, state: "windows_visible_entry_unproven" };
  },
  async createWorkspace(parent, child) {
    await mkdir(join(parent, child));
    return { child, state: "windows_visible_entry_unproven" };
  },
};

it("creates multiple tasks and lists a legacy v1 task after reopening", async () => {
  const workspace = await temp();
  const store = new WorkspaceStore(writer);
  await store.select(workspace);
  const a = await store.createTask(input);
  const b = await store.createTask({ ...input, question: "Second research task" });
  expect(a.handle).not.toBe(b.handle);
  expect((await store.view()).tasks).toHaveLength(2);
  const legacy = join(workspace, "cli-task-1");
  const request = { question: "Created by CLI", budget: 0.01, researchMode: "deep", packageVersion: "1.0.0", responseMode: "async" };
  await mkdir(legacy);
  await writeFile(join(legacy, "request.json"), JSON.stringify(request) + "\n");
  await writeFile(join(legacy, "task.json"), JSON.stringify({ schema: "keryx-operator-task-v1",
    id: "123e4567-e89b-42d3-a456-426614174000", createdAt: new Date().toISOString(), kind: "paid_research",
    request, payee: input.payee, maxTotalMicros: "100000" }) + "\n");
  const relaunched = new WorkspaceStore(writer);
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
  const store = new WorkspaceStore(writer); await store.select(workspace);
  const imported = await store.importReference(source);
  const importedAgain = await store.importReference(source);
  expect(importedAgain.handle).not.toBe(imported.handle);
  expect(imported.sha256).toBe(createHash("sha256").update(content).digest("hex"));
  await writeFile(source, "changed later");
  expect(await readFile(join(workspace, "references", `${imported.handle}.txt`))).toEqual(content);
  expect((await store.references()).map(ref => ref.name)).toEqual(["note.md", "note.md"]);
  const link = join(root, "link.md");
  try { await symlink(source, link); await expect(store.importReference(link)).rejects.toThrow(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; }
  const large = join(root, "large.txt"); await writeFile(large, Buffer.alloc(262145, 65));
  await expect(store.importReference(large)).rejects.toThrow(/too large/);
});

it("does not follow replaced workspace roots or oversized adjacent buyer journals", async () => {
  const root = await temp(); const workspace = join(root, "workspace"); const alternate = join(root, "alternate");
  await mkdir(workspace); await mkdir(alternate);
  const store = new WorkspaceStore(writer); await store.select(workspace);
  const task = await store.createTask(input);
  const buyer = join(workspace, task.directoryName, "buyer"); await mkdir(buyer);
  await writeFile(join(buyer, "intent.json"), Buffer.alloc(65537, 65));
  expect((await store.view()).invalidDirectories).toBe(1);
  await rm(workspace, { recursive: true }); await symlink(alternate, workspace, "junction");
  await expect(store.createTask(input)).rejects.toThrow(/workspace has changed/);
});

it("retains and names a task whose native success cannot be reopened", async () => {
  const workspace = await temp();
  const incomplete: DesktopTaskWriter = {
    ...writer,
    async create({ parent, child, id }) {
      await mkdir(join(parent, child));
      return { taskId: id, child, state: "windows_visible_entry_unproven" };
    },
  };
  const store = new WorkspaceStore(incomplete);
  await store.select(workspace);
  await expect(store.createTask(input)).rejects.toThrow(
    /Do not retry at the same location; keep this path for inspection: .*task-/);
  expect((await (await import("node:fs/promises")).readdir(workspace)).filter(name => name.startsWith("task-"))).toHaveLength(1);
});

it.each(["retained_partial", "complete_unconfirmed", "unknown"] as const)(
  "keeps the no-retry instruction ahead of a long multi-byte path for %s", (state) => {
    const path = "D:\\资料\\Keryx\\" + "研究报告-草稿-✓\\".repeat(200) + "task-" + "0".repeat(36);
    const message = creationError({ state }, path).message;
    expect(message).toContain(path);
    const bound = boundErrorMessage(message);
    expect(Buffer.byteLength(bound, "utf8")).toBeLessThanOrEqual(MAX_ERROR_BYTES);
    expect(bound).toContain("Creation could not be confirmed");
    expect(bound).toContain("Do not retry at the same location");
    expect(bound).toContain("for inspection");
    expect(bound.indexOf("Do not retry")).toBeLessThan(bound.indexOf("inspection:"));
  });

it("refuses unavailable trusted writer before creating any task directory", async () => {
  const workspace = await temp();
  const unavailable: DesktopTaskWriter = {
    ...writer,
    async create() { throw Object.assign(new Error("artifact unavailable"), { state: "refused_unchanged", stage: "artifact" }); },
  };
  const store = new WorkspaceStore(unavailable);
  await store.select(workspace);
  await expect(store.createTask(input)).rejects.toThrow(/Reinstall this desktop release/);
  expect(await (await import("node:fs/promises")).readdir(workspace)).toEqual([]);
});

it("passes selected lexical parents to native admission so linked ancestors stay visible", async () => {
  const root = await temp();
  const real = join(root, "real"); const workspace = join(real, "workspace"); const alias = join(root, "alias");
  await mkdir(real); await mkdir(workspace);
  try { await symlink(real, alias, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") return; throw error; }
  let taskParent = ""; let workspaceParent = "";
  const noLinks: DesktopTaskWriter = {
    async create(value) {
      taskParent = value.parent;
      throw Object.assign(new Error("linked ancestor"), { state: "refused_unchanged", stage: "parent" });
    },
    async createWorkspace(parent) {
      workspaceParent = parent;
      throw Object.assign(new Error("linked ancestor"), { state: "refused_unchanged", stage: "parent" });
    },
  };
  const store = new WorkspaceStore(noLinks);
  await store.select(join(alias, "workspace"));
  expect(store.selectedPath).toBe(join(alias, "workspace"));
  await expect(store.createTask(input)).rejects.toThrow(/No new item was created/);
  expect(taskParent).toBe(join(alias, "workspace"));
  expect(await (await import("node:fs/promises")).readdir(workspace)).toEqual([]);
  await expect(store.create(join(alias, "workspace"))).rejects.toThrow(/No new item was created/);
  expect(workspaceParent).toBe(join(alias, "workspace"));
  expect((await (await import("node:fs/promises")).readdir(real))).toEqual(["workspace"]);
});

it("preserves legacy testnet and new mainnet task identities side by side without payments", async () => {
  const workspace = await temp(), store = new WorkspaceStore(writer); await store.select(workspace);
  const old = await store.createTask(input), current = await store.createTask({ ...input, network: "arc" });
  expect(old.status.network).toBe("eip155:5042002"); expect(current.status.network).toBe("eip155:5042");
  const reopened = new WorkspaceStore(writer); const view = await reopened.select(workspace);
  expect(view.tasks.map(task => task.status.network).sort()).toEqual(["eip155:5042", "eip155:5042002"]);
  await expect(reopened.resumeTask(view.tasks.find(task => task.status.network === "eip155:5042")!.handle)).rejects.toThrow(/different network/);
  const bytes = JSON.parse(await readFile(join(workspace, current.directoryName, "task.json"), "utf8"));
  expect(bytes).toMatchObject({ schema: "keryx-operator-task-v2", network: "eip155:5042" });
});
