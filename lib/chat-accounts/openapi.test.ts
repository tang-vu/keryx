import { describe, expect, it, vi } from "vitest";
import { openapiSpec } from "../openapi-spec";
import type { KeryxDB } from "../db/keryx-db";
import { completionSchema, recipientSchema, ChatAccountError } from "./contracts";
import { createChatAccountRoutes } from "./http";
import { chatAccountOpenApiPaths } from "./openapi";

const path = "/api/me/chat-accounts", finish = "/api/me/chat-accounts/complete";
const list = chatAccountOpenApiPaths[path].get, post = chatAccountOpenApiPaths[path].post;
const complete = chatAccountOpenApiPaths[finish].post;
const binding = { origin: "https://chat-contract.invalid", network: "eip155:5042" as const };
const token = "a".repeat(64), wallet = `0x${"1".repeat(40)}`, hash = "2".repeat(64), accountId = `acct_${"3".repeat(64)}`;

// Request-boundary collaborators only; no actual native DB, login, signer or provider.
function fixture() {
  const now = Date.now();
  const snapshot = { membership: { version: 1, accountId, revision: 1, createdAt: now - 1000,
    members: [{ wallet, generation: "4".repeat(64), linkedAt: now - 1000 }] },
    session: { sessionHash: hash, wallet, issuedAt: now - 1000, expiresAt: now + 10000 },
    memberGeneration: "4".repeat(64), credentialGeneration: "5".repeat(64), binding };
  const resolve = vi.fn().mockResolvedValue(snapshot), listLinks = vi.fn().mockResolvedValue([]);
  const preview = vi.fn().mockRejectedValue(new ChatAccountError("chat_token_invalid"));
  const consume = vi.fn(), unlinkAccount = vi.fn();
  const getWebSession = vi.fn().mockResolvedValue({ hash, wallet, issuedAt: now - 1000, expiresAt: now + 10000 });
  const db = Object.defineProperties({ getWebSession }, {
    accountMembership: { value: { resolve, assertCurrent: vi.fn() } },
    chatAccountLinks: { value: { preview, complete: consume, unlinkAccount, list: listLinks, issue: vi.fn(), lookup: vi.fn(), unlink: vi.fn() } },
  }) as unknown as KeryxDB;
  const session = vi.fn<Parameters<typeof createChatAccountRoutes>[0]["session"]>().mockResolvedValue({ db, wallet, currentId: hash });
  return { routes: createChatAccountRoutes({ binding, session }), session, resolve, getWebSession, preview, consume, unlinkAccount };
}
function request(value: unknown, target = path, headers: Record<string, string> = {}) {
  return new Request(binding.origin + target, { method: "POST", headers: { Origin: binding.origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(value) });
}
async function refusal(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(Reflect.get(post.responses, String(status))).toBeDefined();
  expect(Reflect.get(complete.responses, String(status))).toBeDefined();
  expect(await response.json()).toEqual({ error });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

describe("chat263 additive OpenAPI contract (authored UNRUN)", () => {
  it("registers only actual methods with existing cookie security and no key/payment alternatives", () => {
    for (const [url, item] of Object.entries(chatAccountOpenApiPaths)) expect(Reflect.get(openapiSpec.paths, url)).toEqual(item);
    expect(Object.keys(chatAccountOpenApiPaths[path])).toEqual(["get", "post"]);
    expect(Object.keys(chatAccountOpenApiPaths[finish])).toEqual(["post"]);
    for (const operation of [list, post, complete]) {
      expect(operation.security).toEqual([{ WebSession: [] }]);
      expect(openapiSpec.components.securitySchemes.WebSession.name).toBe("keryx_session");
      expect(operation.description).toContain("API keys are not eligible");
      expect(operation.description).toContain("X-Keryx-Expected-Wallet is not enforced");
      expect(operation.description).toContain("No query parameters");
    }
    expect(post.parameters.map(p => p.name)).toEqual(["Origin"]);
    expect(complete.parameters).toEqual(post.parameters);
    expect(JSON.stringify(chatAccountOpenApiPaths)).not.toContain("#/components/schemas/");
  });

  it("matches strict completion bounds/consent and never publishes tokens in successful bodies", () => {
    const schema = complete.requestBody.content["application/json"].schema;
    const value = { token, consentProof: `123.${"b".repeat(64)}`, accountId, revision: 1,
      consent: { version: 1, linkFutureRuns: true, financialAuthorityUnchanged: true }, pastRunIds: [] };
    expect(completionSchema.safeParse(value).success).toBe(true);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(value).sort()).toEqual([...schema.required].sort());
    expect(schema.properties.token.writeOnly).toBe(true);
    expect(schema.properties.pastRunIds.maxItems).toBe(0);
    for (const invalid of [{ ...value, wallet }, { ...value, recipient: {} }, { ...value, pastRunIds: ["historical"] },
      { ...value, consent: { ...value.consent, extra: true } }, { ...value, revision: Number.MAX_SAFE_INTEGER + 1 }])
      expect(completionSchema.safeParse(invalid).success).toBe(false);
    for (const candidate of [token, token.toUpperCase(), "a".repeat(63), "z".repeat(64)])
      expect(new RegExp(schema.properties.token.pattern).test(candidate)).toBe(completionSchema.safeParse({ ...value, token: candidate }).success);
    for (const response of [list.responses["200"], post.responses["200"], complete.responses["200"]]) {
      expect(JSON.stringify(response)).not.toMatch(/"(?:token|wallet|sessionHash|memberGeneration|credentialGeneration)"/);
    }
    expect(list.responses["200"].content["application/json"].schema.properties.links.maxItems).toBe(32);
    expect(complete.description).toContain("not wallet or payment inheritance");
  });

  it("matches provider-specific recipient patterns without granting private issue authority", () => {
    const schema = Reflect.get(post.requestBody.content["application/json"].schema.oneOf[1].properties, "recipient") as {
      oneOf: { additionalProperties: boolean; properties: Record<string, { pattern?: string; const?: string }> }[];
    };
    const values = [
      { platform: "telegram", scope: "telegram", userId: "7", channel: "7" },
      { platform: "slack", scope: "T123", userId: "U123", channel: "D123" },
      { platform: "discord", scope: "123", userId: "456", channel: "789" },
    ];
    for (const [index, value] of values.entries()) {
      expect(recipientSchema.safeParse(value).success).toBe(true);
      const branch = schema.oneOf[index];
      expect(branch.additionalProperties).toBe(false);
      for (const field of ["scope", "userId", "channel"] as const) {
        const property = branch.properties[field] as { pattern?: string; const?: string };
        expect(property.pattern ? new RegExp(property.pattern).test(value[field]) : value[field] === property.const).toBe(true);
      }
      expect(recipientSchema.safeParse({ ...value, userId: "unknown" }).success).toBe(false);
      expect(recipientSchema.safeParse({ ...value, wallet }).success).toBe(false);
    }
  });

  it("refuses bearer, foreign origin and query credentials before session lookup", async () => {
    const f = fixture();
    await refusal(await f.routes.account(request({ action: "preview", token }, path, { Authorization: "Bearer synthetic" })), 401, "interactive_session_required");
    await refusal(await f.routes.account(request({ action: "preview", token }, path, { Origin: "https://foreign.invalid" })), 403, "same_origin_required");
    await refusal(await f.routes.account(request({ action: "preview", token }, path + "?token=" + token)), 400, "invalid_chat_request");
    expect(f.session).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled(); expect(f.consume).not.toHaveBeenCalled();
  });

  it("keeps membership and exact durable-row refusals distinct without key or owner fallback", async () => {
    const f = fixture(); f.getWebSession.mockResolvedValueOnce({ hash, wallet: `0x${"f".repeat(40)}` });
    await refusal(await f.routes.account(request({ action: "preview", token })), 401, "interactive_session_required");
    f.resolve.mockResolvedValueOnce(null);
    await refusal(await f.routes.account(request({ action: "preview", token })), 409, "explicit_account_membership_required");
    expect(f.preview).not.toHaveBeenCalled(); expect(f.consume).not.toHaveBeenCalled();
  });

  it("documents actual body-parser statuses, unknown-property refusal, expiry and unknown exceptions", async () => {
    const f = fixture();
    await refusal(await f.routes.account(request({ action: "preview", token, wallet })), 400, "invalid_chat_request");
    await refusal(await f.routes.account(request({ action: "preview", token }, path, { "Content-Type": "text/plain" })), 503, "chat_invalid_command");
    await refusal(await f.routes.account(request({ action: "preview", token, padding: "x".repeat(4096) })), 503, "chat_invalid_command");
    await refusal(await f.routes.account(new Request(binding.origin + path, { method: "POST", headers: { Origin: binding.origin, "Content-Type": "application/json" }, body: "{" })), 503, "chat_unavailable");
    await refusal(await f.routes.account(request({ action: "preview", token })), 410, "chat_token_invalid");
    f.preview.mockRejectedValueOnce(new Error("private exception " + token));
    await refusal(await f.routes.account(request({ action: "preview", token })), 503, "chat_unavailable");
    await refusal(await f.routes.complete(request({ pastRunIds: ["old-run"] }, finish)), 409, "chat_past_runs_unavailable");
    await refusal(await f.routes.complete(request({ token, wallet }, finish)), 400, "invalid_chat_consent");
    expect(f.consume).not.toHaveBeenCalled(); expect(f.unlinkAccount).not.toHaveBeenCalled();
  });

  it("lists closed owner projections and implements unlink as POST with account comparison", async () => {
    const f = fixture();
    const result = await f.routes.account(new Request(binding.origin + path));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ account: { accountId, revision: 1 }, links: [], pastRuns: {
      status: "unavailable", reason: "No verified retained chat-user provenance exists for historical runs.",
    } });
    const recipient = { platform: "telegram", scope: "telegram", userId: "7", channel: "7" };
    await refusal(await f.routes.account(request({ action: "unlink", recipient, accountId, revision: 2 })), 409, "chat_account_changed");
    const unlinked = await f.routes.account(request({ action: "unlink", recipient, accountId, revision: 1 }));
    expect(unlinked.status).toBe(200); expect(await unlinked.json()).toEqual({ unlinked: true });
    expect(f.unlinkAccount).toHaveBeenCalledTimes(1); expect(f.consume).not.toHaveBeenCalled();
    const unsupported = await f.routes.account(new Request(binding.origin + path, { method: "DELETE" }));
    expect(unsupported.status).toBe(405); expect(await unsupported.json()).toEqual({ error: "method_not_allowed" });
    // Factory refusal only: no DELETE export is advertised by OpenAPI.
    expect(chatAccountOpenApiPaths[path]).not.toHaveProperty("delete");
  });
});
