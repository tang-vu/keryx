import { beforeEach, describe, expect, it, vi } from "vitest";
import { openapiSpec } from "../openapi-spec";
import { config } from "../config";
import { personalHistoryOpenApiPaths } from "./openapi";
import { ownedHistoryOpenApiPaths } from "./owned-history-openapi";
import { privateJobHistoryOpenApiPaths } from "./private-job-history-openapi";
import { PRIVATE_JOB_HISTORY_BOUNDS as B, privateJobHistoryInputSchema, privateJobHistoryDetailInputSchema,
  privateJobHistoryRowSchema, privateJobHistoryPageSchema, privateJobHistoryExportSchema } from "./private-job-history-contract";
import { runClaimPrivateHeaders } from "../run-claims/private-response";

const boundary = vi.hoisted(() => ({ session: vi.fn(), key: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/account-sessions", () => ({ accountSessionContext: boundary.session }));
vi.mock("@/lib/api-keys", () => ({ verifyApiKey: boundary.key }));
vi.mock("@/lib/db", () => ({ getDb: boundary.db }));
vi.mock("@/lib/config", async importOriginal => {
  const original = await importOriginal<typeof import("../config")>();
  return { ...original, config: { ...original.config, baseUrl: "https://private-openapi.invalid" } };
});
import * as list from "@/app/api/me/private-jobs/route";
import * as detail from "@/app/api/me/private-jobs/detail/route";
import * as exporter from "@/app/api/me/private-jobs/export/route";

const origin = new URL(config.baseUrl).origin, wallet = `0x${"a".repeat(40)}`, token = `kx_live_${"b".repeat(96)}`;
const definitions = [
  { path: "/api/me/private-jobs", routes: list, body: {} },
  { path: "/api/me/private-jobs/detail", routes: detail, body: { id: `prv_${"c".repeat(64)}` } },
  { path: "/api/me/private-jobs/export", routes: exporter, body: {} },
] as const;
function storage() {
  return { listPrivateResearchHistory: vi.fn(async () => []), getPrivateResearchIntent: vi.fn(async () => null),
    getPrivateResearchResult: vi.fn(async () => null), getPrivateResearchExecution: vi.fn(async () => null),
    getPrivatePaymentState: vi.fn(async () => null) };
}
let db = storage();
beforeEach(() => {
  vi.clearAllMocks(); db = storage();
  boundary.session.mockResolvedValue({ wallet, db, currentId: "d".repeat(64) });
  boundary.key.mockResolvedValue({ walletAddress: wallet, scopes: "history:read" });
  boundary.db.mockResolvedValue(db);
});
function request(path: string, body: unknown = {}, headers: Record<string, string> = { Origin: origin }, method = "POST") {
  return new Request(origin + path, { method, headers: { "Content-Type": "application/json", ...headers },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
}
function documented(path: string) { return Reflect.get(privateJobHistoryOpenApiPaths, path).post; }

describe("published completed-private-job OpenAPI contract", () => {
  it("publishes exactly the three mounted POST operations through the real aggregate and preserves prior history", () => {
    expect(Object.keys(privateJobHistoryOpenApiPaths)).toEqual(definitions.map(value => value.path));
    for (const { path, routes } of definitions) {
      expect(Object.keys(Reflect.get(privateJobHistoryOpenApiPaths, path))).toEqual(["post"]);
      expect(Reflect.get(openapiSpec.paths, path)).toEqual(Reflect.get(privateJobHistoryOpenApiPaths, path));
      expect(routes.POST).toBeTypeOf("function"); expect(routes.GET).toBe(routes.POST);
      expect(documented(path).security).toEqual([{ WebSession: [] }, { ApiKeyAuth: [] }]);
      for (const requirement of documented(path).security) for (const scheme of Object.keys(requirement))
        expect(Reflect.get(openapiSpec.components.securitySchemes, scheme)).toBeDefined();
      expect(documented(path).parameters.every((parameter: { in: string }) => parameter.in === "header")).toBe(true);
    }
    for (const [path, operation] of Object.entries(ownedHistoryOpenApiPaths))
      expect(Reflect.get(personalHistoryOpenApiPaths, path)).toEqual(operation);
    expect(openapiSpec.paths["/api/me/history"].get.operationId).toBe("readPersonalHistory");
  });

  it("binds POST fields, date/id syntax and documented bounds to the actual accepted input contracts", () => {
    const input = privateJobHistoryOpenApiPaths["/api/me/private-jobs"].post.requestBody.content["application/json"].schema;
    const actualFields = Object.keys(privateJobHistoryInputSchema.innerType().shape);
    expect(input.additionalProperties).toBe(false);
    expect(Object.keys(input.properties).sort()).toEqual([...actualFields, "format"].sort());
    expect(input.properties.limit.maximum).toBe(B.rows);
    expect(privateJobHistoryInputSchema.parse({}).limit).toBe(input.properties.limit.default);
    for (const limit of [0, 1, 25, 26])
      expect(privateJobHistoryInputSchema.safeParse({ limit }).success).toBe(limit >= input.properties.limit.minimum && limit <= input.properties.limit.maximum);
    for (const value of ["2026-10-15T00:00:00Z", "2026-10-15T00:00:00.123456+00:00", "2026-10-15T00:00:00.1234567Z", "2026-10-15T00:00:00+01:00"])
      expect(new RegExp(input.properties.from.pattern).test(value)).toBe(privateJobHistoryInputSchema.safeParse({ from: value }).success);
    const detailInput = privateJobHistoryOpenApiPaths["/api/me/private-jobs/detail"].post.requestBody.content["application/json"].schema;
    expect(detailInput.required).toEqual(["id"]); expect(Object.keys(detailInput.properties)).toEqual(["id", "format"]);
    for (const value of [`prv_${"a".repeat(64)}`, "a2a_original", `prv_${"A".repeat(64)}`, "prv_short"])
      expect(new RegExp(detailInput.properties.id.pattern).test(value)).toBe(privateJobHistoryDetailInputSchema.safeParse({ id: value }).success);
    expect(B.requestBytes).toBe(8192); expect(B.readMs).toBe(15000); expect(B.exportMs).toBe(25000);
  });

  it("matches mounted method/origin/body/precondition refusals without private reads or cookie fallback", async () => {
    for (const { path, routes, body } of definitions) {
      const priorSessions = boundary.session.mock.calls.length;
      const malformedBearer = await routes.POST(request(path, body, { Authorization: "invalid", Cookie: "keryx_session=synthetic-existing-session" }));
      expect(boundary.session.mock.calls.length).toBe(priorSessions);
      const cases = [
        await routes.GET(request(path, {}, { Origin: origin }, "GET")),
        await routes.POST(request(path, body, {})),
        await routes.POST(request(path, body, { Origin: "https://foreign.invalid" })),
        malformedBearer,
        await routes.POST(request(path + "?id=never-a-selector", body)),
        await routes.POST(request(path, { ...body, owner: wallet })),
        await routes.POST(request(path, body, { Origin: origin, "X-Keryx-Expected-Wallet": `0x${"e".repeat(40)}` })),
      ];
      expect(cases.map(response => response.status)).toEqual([405, 403, 403, 401, 400, 400, 409]);
      for (const response of cases) {
        expect(Reflect.get(documented(path).responses, String(response.status))).toBeDefined();
        for (const header of runClaimPrivateHeaders) expect(response.headers.get(header.key)).toBe(header.value);
      }
      expect(cases[0].headers.get("allow")).toBe("POST");
    }
    expect(db.listPrivateResearchHistory).not.toHaveBeenCalled(); expect(db.getPrivateResearchIntent).not.toHaveBeenCalled();
  });

  it("matches explicit key scope, missing detail and bounded JSON/CSV metadata responses", async () => {
    boundary.key.mockResolvedValueOnce({ walletAddress: wallet, scopes: "export" });
    const refused = await list.POST(request("/api/me/private-jobs", {}, { Authorization: `Bearer ${token}` }));
    expect(refused.status).toBe(403); expect(await refused.json()).toEqual({ error: "insufficient_scope" });
    expect(boundary.db).not.toHaveBeenCalled(); expect(boundary.session).not.toHaveBeenCalled();
    const page = await list.POST(request("/api/me/private-jobs", {}, { Authorization: `Bearer ${token}` }));
    expect(page.status).toBe(200); const value = privateJobHistoryPageSchema.parse(await page.json());
    const schema = privateJobHistoryOpenApiPaths["/api/me/private-jobs"].post.responses["200"].content["application/json"].schema;
    expect(Object.keys(value).sort()).toEqual([...schema.required].sort());
    expect(Object.keys(schema.properties.rows.items.properties).sort()).toEqual(Object.keys(privateJobHistoryRowSchema.shape).sort());
    expect(schema.properties.rows.maxItems).toBe(B.rows);
    for (const name of ["ownSettledSpendMicros", "creatorRewardsMicros", "paidCreators"] as const)
      expect(schema.properties.rows.items.properties[name]).toEqual({ type: "null" });
    const missing = await detail.POST(request("/api/me/private-jobs/detail", definitions[1].body));
    expect(missing.status).toBe(404); expect(await missing.json()).toEqual({ error: "not_found" });
    const exported = await exporter.POST(request("/api/me/private-jobs/export"));
    expect(exported.status).toBe(200); const metadata = privateJobHistoryExportSchema.parse(await exported.json());
    expect(metadata.bounds).toEqual({ maxPages: B.exportPages, maxRows: B.exportRows, maxBytes: B.exportBytes });
    const csv = await exporter.POST(request("/api/me/private-jobs/export", { format: "csv" }));
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("x-keryx-history-truncated")).toBe("false");
    expect(await csv.text()).toContain('"metadata"');
    expect(boundary.key).toHaveBeenCalledTimes(3); // refusal, accepted read, accepted read's final recheck
  });
});
