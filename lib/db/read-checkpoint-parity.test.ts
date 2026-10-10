import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SqliteAdapter } from "./sqlite-adapter";
import { SupabaseAdapter } from "./supabase-adapter";
import { createReadCheckpointCapture, ordinaryCheckpointCapability } from "../agent/read-checkpoint-capture";
import { actualReadCheckpoint } from "../research-audit/actual-read-policy";
import { canonicalReadPacket, verifyActualReadPacket } from "../research-audit/actual-read-record";
import { projectActualReadCheckpoints } from "../research-audit/actual-read-projection";
import type { QueryRun } from "../types";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("retains bounded checkpoint JSON and its separate digest through both actual ordinary adapters without schema changes", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-read-checkpoint-parity-"));
  const sqlite = new SqliteAdapter(path.join(folder, "fixture.sqlite")); await sqlite.init();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-checkpoint.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  const rows = new Map<string, { data: QueryRun }>();
  const transport = vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname !== "synthetic-checkpoint.example" || url.pathname !== "/rest/v1/query_runs") throw Error("Unexpected adapter transport");
    if (options?.method === "POST") { const row = JSON.parse(String(options.body)); rows.set(row.id, row); return new Response(null, { status: 201 }); }
    const id = url.searchParams.get("id")?.replace(/^eq\./, "");
    return Response.json(id && rows.has(id) ? [rows.get(id)] : []);
  });
  vi.stubGlobal("fetch", transport);
  const supabase = new SupabaseAdapter();
  const collector = createReadCheckpointCapture(true), check = { kind: "channel", creatorFree: false, cache: true } as const;
  collector.append(check, actualReadCheckpoint(check), { candidate: 1, round: 1, proposal: "BUY", plan: "CACHE", price: 0.002, remaining: 0.030000000000000002 });
  const captured = collector.finish(); if (!captured || captured.status !== "available") throw Error("Fixture capture unavailable");
  const run: QueryRun = { id: "synthetic-read-checkpoint", question: "Synthetic retention fixture", budget: 0,
    engine: "heuristic", subClaims: [], decisions: [], citations: [], answer: "Offline fixture", totalSpent: 0,
    totalToCreators: 0, trace: [{ phase: "done", message: "done", ts: 1, readCheckpoints: captured }], createdAt: "2026-10-10T00:00:00.000Z", paymentMode: "offline" };
  const before = JSON.stringify(run);
  try {
    for (const db of [sqlite, supabase]) {
      expect(ordinaryCheckpointCapability(db)).toBe(true);
      await db.saveQueryRun(run);
      const retained = await db.getQueryRun(run.id); expect(retained).not.toBeNull();
      expect(retained?.trace).toEqual(run.trace);
      const projected = projectActualReadCheckpoints(retained!); expect(projected).not.toBeNull();
      expect(canonicalReadPacket(projected!.packet)).toBe(canonicalReadPacket(captured.packet));
      expect(projected!.retainedDigest).toBe(captured.retainedDigest);
      expect(await verifyActualReadPacket(projected!.packet, captured.retainedDigest)).toBe(true);
      expect(projected!.packet.records[0].amounts.remainingMicros).toBeNull();
    }
    expect(JSON.stringify(run)).toBe(before); expect(transport).toHaveBeenCalledTimes(2);
  } finally {
    sqlite.close();
    const relative = path.relative(os.tmpdir(), folder);
    if (!relative.startsWith("keryx-read-checkpoint-parity-") || relative.includes("..") || path.isAbsolute(relative)) throw Error("Unsafe fixture cleanup");
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
