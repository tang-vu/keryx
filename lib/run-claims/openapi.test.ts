import { describe, expect, it, vi } from "vitest";
import { openapiSpec } from "../openapi-spec";
import { historyInputSchema, parseHistoryQuery } from "../history/personal-history";
import { buildChunk, buildCompletion, keryxMeta } from "../openai-compat";
import type { QueryRun } from "../types";
import type { KeryxDB } from "../db/keryx-db";
import { RUN_CLAIM_TTL_MS, runClaimIdSchema, runClaimReceiptSchema, runClaimTokenSchema } from "./contracts";
import { privateRunClaimPacketSchema } from "./private-packet";
import { readRunOwnershipHistory, summarizeOwnershipOriginal } from "./history";
import { createRunClaimRoutes } from "./http";
import { runClaimOpenApiPaths, runClaimOpenApiSchemas, privateRunClaimOpenAiProperties, privateRunClaimOpenAiStream } from "./openapi";

const wallet = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`;
const binding = { network: "eip155:5042002" as const, origin: "https://private-contract.invalid" };
const createdAt = "2026-10-11T00:00:00.000Z";
const run: QueryRun = { id: "synthetic-original", createdAt, question: "Synthetic question", answer: "Synthetic saved answer",
  budget: 0, engine: "heuristic", subClaims: [], decisions: [], citations: [], trace: [], totalSpent: 0, totalToCreators: 0, paymentMode: "offline" };
const post = runClaimOpenApiPaths["/api/me/run-claims"].post;
const list = runClaimOpenApiPaths["/api/me/run-history"].get;
const detail = runClaimOpenApiPaths["/api/me/run-history/{id}"].get;

function references(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => key === "$ref" && typeof child === "string" ? [child] : references(child));
}
function resolve(ref: string): unknown {
  return ref.slice(2).split("/").reduce<unknown>((value, key) => value && typeof value === "object"
    ? Reflect.get(value, key.replace(/~1/g, "/").replace(/~0/g, "~")) : undefined, openapiSpec);
}

describe("private claim and ownership-history OpenAPI contracts", () => {
  it("registers all real routes, resolves every new schema reference and names actual security schemes", () => {
    for (const [path, operation] of Object.entries(runClaimOpenApiPaths)) expect(Reflect.get(openapiSpec.paths, path)).toEqual(operation);
    for (const ref of references({ runClaimOpenApiPaths, runClaimOpenApiSchemas, privateRunClaimOpenAiStream })) expect(resolve(ref), ref).toBeDefined();
    for (const operation of [post, list, detail]) for (const requirement of operation.security)
      for (const scheme of Object.keys(requirement)) expect(Reflect.get(openapiSpec.components.securitySchemes, scheme)).toBeDefined();
    expect(post.security).toEqual([{ WebSession: [] }]);
    expect(post.description).toContain("SIWE or verified Circle Google login");
    expect(list.description).toContain("SIWE or verified Circle Google login");
    expect(openapiSpec.components.securitySchemes.WebSession.description).toContain("SIWE or verified Circle Google login");
    expect(list.security).toEqual([{ WebSession: [] }, { ApiKeyAuth: [] }]);
    expect(detail.security).toEqual(list.security);
  });

  it("resolves every operation security reference in the complete published spec without inventing an auth alias", () => {
    let requirements = 0;
    for (const [path, item] of Object.entries(openapiSpec.paths)) for (const [method, operation] of Object.entries(item)) {
      if (!operation || typeof operation !== "object" || !("security" in operation)) continue;
      const security = Reflect.get(operation, "security") as Record<string, string[]>[];
      for (const requirement of security) for (const scheme of Object.keys(requirement)) {
        requirements++; expect(Reflect.get(openapiSpec.components.securitySchemes, scheme), `${method} ${path}: ${scheme}`).toBeDefined();
      }
    }
    expect(requirements).toBeGreaterThan(3);
    expect(openapiSpec.components.securitySchemes).not.toHaveProperty("SessionCookie");
    expect(openapiSpec.paths["/api/me/history"].get.security).toEqual([{ WebSession: [] }, { ApiKeyAuth: [] }]);
    expect(openapiSpec.paths["/api/me/deliverables/{id}/acceptance"].get.security).toEqual([{ WebSession: [] }, { ApiKeyAuth: [] }]);
    expect(openapiSpec.paths["/api/me/deliverables/{id}/acceptance"].post.security).toEqual([{ WebSession: [] }, { ApiKeyAuth: [] }]);
  });

  it("keeps the token write-only and the documented token/id spelling aligned with actual contracts", () => {
    const body = post.requestBody.content["application/json"].schema;
    expect(body.additionalProperties).toBe(false); expect(body.required).toEqual(["token"]);
    expect(Object.keys(body.properties)).toEqual(["token"]); expect(body.properties.token.writeOnly).toBe(true);
    for (const token of ["a".repeat(64), "A".repeat(64), "a".repeat(63), "a".repeat(65), "z".repeat(64)])
      expect(new RegExp(body.properties.token.pattern).test(token)).toBe(runClaimTokenSchema.safeParse(token).success);
    const id = detail.parameters.find(parameter => parameter.in === "path")!;
    for (const value of [run.id, "prv_secret", "a2a_original", "bad id", "a".repeat(129)])
      expect(new RegExp(id.schema.pattern!).test(value)).toBe(runClaimIdSchema.safeParse(value).success);
    expect(post.parameters.filter(parameter => parameter.required).map(parameter => parameter.name)).toEqual(["X-Keryx-Expected-Wallet", "Origin"]);
  });

  it("documents actual precondition/default-off refusals without turning expected-wallet or bearer into claim authority", async () => {
    const db = { runClaims: { assertAvailable: vi.fn(), issue: vi.fn(), claim: vi.fn() } } as unknown as KeryxDB;
    const deps = { enabled: true, binding, session: vi.fn(async () => ({ db, wallet, currentId: "a".repeat(64) })),
      key: vi.fn(), db: vi.fn(async () => db) };
    const routes = createRunClaimRoutes(deps);
    const request = (headers: Record<string, string> = {}) => new Request(binding.origin + "/api/me/run-claims", { method: "POST",
      headers: { Origin: binding.origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify({ token: "a".repeat(64) }) });
    for (const [response, code] of [
      [await routes.POST(request()), "owner_precondition_required"],
      [await routes.POST(request({ "X-Keryx-Expected-Wallet": other })), "owner_changed"],
      [await routes.POST(request({ Authorization: `Bearer kx_live_${"a".repeat(96)}` })), "interactive_session_required"],
      [await createRunClaimRoutes({ ...deps, enabled: false }).POST(request()), "claims_unavailable"],
    ] as const) {
      const documented = Reflect.get(post.responses, String(response.status));
      expect(documented).toBeDefined(); expect(documented.description).toContain(code);
      expect(await response.json()).toEqual({ error: code });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(db.runClaims!.assertAvailable).not.toHaveBeenCalled(); expect(deps.key).not.toHaveBeenCalled();
    expect(post.description).toContain("no lookup/reissue/transfer"); expect(post.description).toContain("20/IP/minute");
    expect(post.description).toContain("256 bytes"); expect(post.description).toContain("5-second");
  });

  it("keeps the advertised API window bounds aligned with accepted and refused history queries", () => {
    const query = list.parameters.filter(parameter => parameter.in === "query");
    expect(query.map(parameter => parameter.name).sort()).toEqual(["limit", "cursor", "search", "surface", "funding", "from", "to"].sort());
    const limit = query.find(parameter => parameter.name === "limit")!.schema as { minimum: number; maximum: number; default: number };
    expect(historyInputSchema.parse({}).limit).toBe(limit.default);
    for (const value of [0, 1, 25, 50, 51]) expect(value >= limit.minimum && value <= limit.maximum).toBe(historyInputSchema.safeParse({ limit: value }).success);
    expect(runClaimOpenApiSchemas.RunOwnershipHistoryPage.properties.rows.maxItems).toBe(limit.maximum);
    for (const name of ["cursor", "search"] as const) {
      const bound = (query.find(parameter => parameter.name === name)!.schema as { maxLength: number }).maxLength;
      expect(historyInputSchema.safeParse({ [name]: "a".repeat(bound) }).success).toBe(true);
      expect(historyInputSchema.safeParse({ [name]: "a".repeat(bound + 1) }).success).toBe(false);
    }
    expect(() => parseHistoryQuery(new URLSearchParams("limit=25&limit=25"))).toThrow();
    expect(() => parseHistoryQuery(new URLSearchParams("wallet=" + other))).toThrow();
    expect(list.description).toContain("Unknown/duplicate"); expect(list.description).toContain("not a transaction snapshot");
    expect(detail.description).toContain("No query parameters");
  });

  it("describes recorded/claimed sidecars and actual bounded pages without claiming claimant funding or rewriting originals", async () => {
    const before = JSON.stringify(run);
    const row = { ...summarizeOwnershipOriginal(run), ownership: { method: "claimed" as const, claimedAt: createdAt } };
    const page = await readRunOwnershipHistory({ list: async () => [row], read: async () => ({ run, ownership: row.ownership }) }, wallet, binding, {});
    expect(Object.keys(page).sort()).toEqual([...runClaimOpenApiSchemas.RunOwnershipHistoryPage.required].sort());
    expect(Object.keys(page.rows[0]).sort()).toEqual([...runClaimOpenApiSchemas.RunOwnershipHistoryRow.required].sort());
    expect(page).toMatchObject({ wallet, binding, scope: "ownership-current-store", nextCursor: null });
    expect(page.rows[0].funding).toBe("other-or-unknown"); expect(JSON.stringify(run)).toBe(before);
    expect(runClaimOpenApiSchemas.RunOwnership.oneOf.map(schema => schema.properties.method.const)).toEqual(["recorded", "claimed"]);
    expect(runClaimOpenApiSchemas.RunOwnershipHistoryRow.description).toContain("not independent settlement or claimant-spend");
    expect(runClaimOpenApiSchemas.RunOwnershipOriginal.description).toContain("4,000,000 UTF-8 bytes");
    expect(runClaimOpenApiSchemas.RunOwnershipOriginal.additionalProperties).toBe(true);
    expect(list.description).toContain("Bearer presence never falls back to cookies");
    expect(list.description).toContain("native/enrolled");
  });

  it("documents the real OpenAI-shaped pre-provider claim refusal rather than a string error envelope", () => {
    const error = runClaimOpenApiSchemas.PrivateRunClaimOpenAiAdmissionError;
    expect(error.required).toEqual(["error"]);
    expect(error.properties.error.required).toEqual(["message", "type", "code"]);
    expect(error.properties.error.properties.type.const).toBe("invalid_request_error");
    expect(error.properties.error.properties.code.const).toBe("claims_unavailable");
    expect(openapiSpec.paths["/api/v1/chat/completions"].post.responses["503"].content["application/json"].schema.oneOf).toContainEqual({ $ref: "#/components/schemas/PrivateRunClaimOpenAiAdmissionError" });
    expect(error.description).toContain("before research");
  });

  it("matches the strict available/unavailable packet and places the optional private extension outside public answer metadata", () => {
    const packet = privateRunClaimPacketSchema.parse({ version: 1, runId: run.id, status: "available", delivery: { version: 1,
      claimUrl: `${binding.origin}/claim-run#${"a".repeat(64)}`, expiresAt: new Date(Date.parse(createdAt) + RUN_CLAIM_TTL_MS).toISOString() } });
    if (packet.status !== "available") throw new Error("Synthetic available packet refused");
    const unavailable = privateRunClaimPacketSchema.parse({ version: 1, runId: run.id, status: "unavailable" });
    const receipt = runClaimReceiptSchema.parse({ version: 1, runId: run.id, wallet, claimedAt: createdAt, binding });
    expect(Object.keys(receipt).sort()).toEqual([...runClaimOpenApiSchemas.RunClaimReceipt.required].sort());
    for (const [value, schema] of [[packet, runClaimOpenApiSchemas.PrivateRunClaimPacket.oneOf[0]], [unavailable, runClaimOpenApiSchemas.PrivateRunClaimPacket.oneOf[1]]] as const) {
      expect(Object.keys(value).sort()).toEqual([...schema.required].sort()); expect(schema.additionalProperties).toBe(false);
    }
    expect(privateRunClaimPacketSchema.safeParse({ ...unavailable, delivery: packet.delivery }).success).toBe(false);
    expect(privateRunClaimPacketSchema.safeParse({ ...packet, token: "a".repeat(64) }).success).toBe(false);
    expect(runClaimOpenApiSchemas.RunClaimDelivery.properties.expiresAt.description).toContain(String(RUN_CLAIM_TTL_MS / 1000));
    const publicCompletion = buildCompletion(run, "keryx"), metadata = keryxMeta(run);
    expect(publicCompletion).not.toHaveProperty("keryx_private"); expect(JSON.stringify(metadata)).not.toContain("claim-run#");
    expect(openapiSpec.components.schemas.ChatCompletion.properties.keryx_private).toEqual(privateRunClaimOpenAiProperties.keryx_private);
    expect(openapiSpec.components.schemas.ChatCompletion.properties.keryx.properties).not.toHaveProperty("keryx_private");
    const terminal = buildChunk("chatcmpl-" + run.id, "keryx", {}, "stop", { keryx: metadata, keryx_private: packet });
    expect(terminal.choices[0].finish_reason).toBe("stop"); expect(terminal.choices[0].delta).toEqual({});
    expect(terminal).toHaveProperty("keryx_private", packet);
    expect(openapiSpec.paths["/api/v1/chat/completions"].post.responses["200"].content["text/event-stream"]).toEqual(privateRunClaimOpenAiStream);
    expect(privateRunClaimOpenAiStream.schema.description).toContain("clean stream EOF");
  });
});
