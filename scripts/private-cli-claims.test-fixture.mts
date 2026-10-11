/** Test preloader: exact CLI import substitutes, isolated SQLite, denied outbound. Never an application launcher. */
import assert from "node:assert/strict";
import { closeSync, fstatSync, openSync, writeSync } from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import { deliveryFixture } from "../lib/run-claims/delivery.test-fixture.ts";
import { preparePrivateRunClaim } from "../lib/run-claims/delivery.ts";
import type { QueryRun } from "../lib/types.ts";

const mode = process.env.KERYX_CLI_CLAIM_FIXTURE_CASE;
assert(["success", "off", "native", "late-issue", "closed-output", "replaced-output", "save-failure", "repeat"].includes(mode ?? ""));
const deny = () => { throw Error("OUTBOUND_DENIED"); };
globalThis.fetch = deny;
http.request = deny; http.get = deny; https.request = deny; https.get = deny;
net.connect = deny; net.createConnection = deny; tls.connect = deny;
dns.lookup = Object.assign(deny, { __promisify__: async () => deny() });
dns.resolve = Object.assign(deny, { __promisify__: async () => deny() }); syncBuiltinESMExports();
const event = (name: string, data: Record<string, unknown> = {}) => writeSync(4, JSON.stringify({ event: name, ...data }) + "\n");
let held: ReturnType<typeof deliveryFixture> | undefined;
const fixture = () => held ??= deliveryFixture();
const binding = { network: "eip155:5042002" as const, origin: "https://claims.example" };
let saved: QueryRun | undefined;
let financialBefore: string | undefined;
const api = {
  async prepareHostedRunClaim(runId: string) {
    event("prepare");
    const f = fixture(), issue = f.store.issue;
    f.store.issue = async input => {
      assert(saved); assert.equal(saved.id, runId);
      assert(f.sql.prepare("SELECT id FROM query_runs WHERE id=?").get(runId));
      event("issue-after-persist");
      if (mode === "late-issue") throw Error("SYNTHETIC_PRIVATE_BACKEND_BODY");
      const issued = await issue(input);
      if (mode === "replaced-output") {
        closeSync(3); assert.equal(openSync("replaced-output.fixture", "wx"), 3);
      }
      return issued;
    };
    return preparePrivateRunClaim({ enabled: true, runId, binding, db: async () => mode === "native" ? {} : f.db });
  },
  getReasoningEngine() { event("provider"); return { name: "Synthetic offline" }; },
  async collectRun(input: { queryId?: string; question: string; provenance: unknown; asker?: string }, callbacks: { onStep(step: unknown): void }) {
    event("research"); assert.equal(Object.hasOwn(input, "asker"), false);
    assert.deepEqual(input.provenance, { version: 1, surface: "cli", ownershipMethod: "unknown" });
    if (mode === "save-failure") throw Error("SYNTHETIC_SAVE_FAILED");
    // The financial values are explicit simulation; the adapter must leave their bytes unchanged.
    const f = fixture();
    saved = f.save(input.queryId ?? "legacy-cli", { question: input.question, origin: "engine", provenance: {
      version: 1, surface: "cli", ownershipMethod: "unknown" }, totalSpent: 0.000001, totalToCreators: 0.000001,
      citations: [{ sourceId: "synthetic-source", sourceName: "Synthetic citation", marker: "S1", rationale: "Synthetic reward", weight: 1, reward: 0.000001 }] });
    for (const kind of ["toll", "citation"]) f.sql.prepare("INSERT INTO payment_events(id,kind,query_id,amount_usdc,settled,settlement_status) VALUES(?,?,?,?,?,?)")
      .run(`synthetic-${kind}`, kind, saved.id, 0.000001, 0, "simulated");
    financialBefore = JSON.stringify(f.sql.prepare("SELECT * FROM payment_events ORDER BY id").all());
    callbacks.onStep({ phase: "done", message: "Synthetic trace contains no private packet" });
    event("persist");
    if (mode === "closed-output") closeSync(3);
    return saved;
  },
};
Object.defineProperty(globalThis, "__keryxPrivateCliClaimFixture", { value: api });
const modules: Record<string, string> = {
  "../lib/run-claims/hosted-delivery.ts": "export const prepareHostedRunClaim=globalThis.__keryxPrivateCliClaimFixture.prepareHostedRunClaim;",
  "../lib/agent/index.ts": "export const collectRun=globalThis.__keryxPrivateCliClaimFixture.collectRun;",
  "../lib/llm/index.ts": "export const getReasoningEngine=globalThis.__keryxPrivateCliClaimFixture.getReasoningEngine;",
  "../lib/llm/research-plan.ts": "export class ResearchPlanningError extends Error{};export const researchFailureMessage=()=> 'Synthetic planning refusal';",
  "../lib/llm/research-selection.ts": "export class ResearchSelectionError extends Error{};",
  "../lib/llm/reasoning-telemetry.ts": "export const reasoningOutputLimitText=()=>null;",
};
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith("/scripts/ask.mts") && Object.hasOwn(modules, specifier))
      return { url: `private-cli-fixture:${specifier}`, shortCircuit: true };
    if (/(?:^|\/)lib\/(?:agent|llm)\//.test(specifier) || /(?:^|\/)lib\/(?:config|db\/index)(?:\.ts)?$/.test(specifier))
      throw Error("UNEXPECTED_APPLICATION_GRAPH");
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("private-cli-fixture:")) return { format: "module", source: modules[url.slice("private-cli-fixture:".length)], shortCircuit: true };
    return next(url, context);
  },
});
process.on("exit", () => {
  if (held) {
    const claims = held.sql.prepare("SELECT token_hash FROM anonymous_run_claims").all();
    const row = saved && held.sql.prepare("SELECT data FROM query_runs WHERE id=?").get(saved.id);
    // Synthetic private data stays in test pipes, never in public CLI output.
    event("final", { claimCount: claims.length, saved: !!row, originalUnchanged: !!row && row.data === JSON.stringify(saved),
      financialUnchanged: financialBefore === JSON.stringify(held.sql.prepare("SELECT * FROM payment_events ORDER BY id").all()),
      hashesOnly: claims.every(row => /^[a-f0-9]{64}$/.test(String(row.token_hash))),
      fd3Type: (() => { try { return Number(fstatSync(3).mode & 0o170000); } catch { return null; } })() });
    held.sql.close();
  }
});
