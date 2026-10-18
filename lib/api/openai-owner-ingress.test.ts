import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RunInput } from "../agent";
import type { QueryRun, TraceStep } from "../types";

// Exercise the real POST, key-format/hash verifier, scope parser and response
// builders. Only the existing DB lookup, admission, claim and collection
// boundaries are synthetic; this does not prove live key-store or paid acceptance.
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), lookupKey: vi.fn(), incrementUsage: vi.fn(),
  admission: vi.fn(), claim: vi.fn(), deps: vi.fn(), collectRun: vi.fn(), outbound: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/agent", () => ({ collectRun: mocks.collectRun, getAgentDeps: mocks.deps }));
vi.mock("@/lib/llm", () => ({ resolveModelChoice: () => undefined }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: mocks.admission }));
vi.mock("@/lib/run-claims/hosted-delivery", () => ({ prepareHostedRunClaim: mocks.claim }));
vi.mock("@/lib/research/availability", () => ({
  readResearchAvailability: () => ({ state: "not-paused", message: "Synthetic fixture availability" }),
}));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "192.0.2.26" }));
vi.mock("@/lib/config", async () => ({ config: {
  profile: (await import("../arc-network-profile")).ARC_TESTNET_PROFILE,
  networkId: "eip155:5042002", baseUrl: "https://synthetic-owner.example",
  sellerAddress: `0x${"2".repeat(40)}`, botKey: "",
  defaultBudget: 0.05, anonMaxBudget: 0.03, a2aMaxBudget: 0.5,
} }));

import { POST } from "../../app/api/v1/chat/completions/route";
import { ResearchPlanningError, researchFailureMessage } from "../llm/research-plan";

const RAW_KEY = `kx_live_${"1".repeat(96)}`;
const KEY_HASH = createHash("sha256").update(RAW_KEY).digest("hex");
const KEY_OWNER = `0x${"a".repeat(40)}`;
const DECLARED_PAYER = `0x${"b".repeat(40)}`;
const FORGED_OWNER = `0x${"c".repeat(40)}`;
const QUESTION = "Synthetic OpenAI ownership fixture";
const KEY_IDENTITY = { walletAddress: KEY_OWNER, keyId: "synthetic-ask-key", scopes: "ask", sourceIds: null };
const API_PROVENANCE = { version: 1, surface: "api", ownershipMethod: "api-key" } as const;
const UNKNOWN_PROVENANCE = { version: 1, surface: "api", ownershipMethod: "unknown" } as const;
const STEP: TraceStep = { phase: "decompose", message: "Synthetic trace without research", ts: 1 };
const store = { verifyApiKey: mocks.lookupKey, incrementUsage: mocks.incrementUsage };
const preparedDeps = { db: store, engine: { name: "synthetic-fixture" }, gateway: { mode: "offline" } };

function request(stream: boolean, key: string | null = RAW_KEY, client = "desktop") {
  return new NextRequest(`https://synthetic-owner.example/api/v1/chat/completions?client=${client}`, {
    method: "POST", headers: {
      "content-type": "application/json", ...(key === null ? {} : { authorization: `Bearer ${key}` }),
      "x-api-key": RAW_KEY, "x-wallet-address": FORGED_OWNER, "x-payer": DECLARED_PAYER,
      "x-keryx-client": client, "user-agent": `synthetic-${client}-${FORGED_OWNER}`,
      "x-run-provenance": JSON.stringify({ version: 1, surface: client, ownershipMethod: "session" }),
      "payment-signature": "synthetic-unverified-payer-metadata",
    }, body: JSON.stringify({
      messages: [{ role: "user", content: QUESTION }], model: "keryx", budget: 1, stream,
      asker: FORGED_OWNER, walletAddress: FORGED_OWNER, payer: DECLARED_PAYER,
      askerFunded: true, fundingOwner: "browser", origin: "engine", mcpClient: client,
      provenance: { version: 1, surface: client, ownershipMethod: "verified-payer" },
    }),
  });
}

// Echo the actual captured adapter input into a no-spend result so the real
// public builders can be checked without running the agent or saving a run.
function completedRun(input: RunInput): QueryRun {
  return { id: input.queryId!, question: input.question, budget: input.budget!,
    asker: input.asker, origin: input.origin, provenance: input.provenance,
    engine: "synthetic-fixture", subClaims: [], decisions: [], citations: [],
    answer: "Synthetic answer without providers or payments", totalSpent: 0, totalToCreators: 0,
    trace: [STEP], createdAt: "2026-10-13T00:00:00.000Z", paymentMode: "offline" };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDb.mockResolvedValue(store);
  // This is the KeryxDB.verifyApiKey(prefix, incomingHash) boundary, not a
  // replacement for lib/api-keys.verifyApiKey(raw). Wrong keys receive no actor.
  mocks.lookupKey.mockImplementation(async (prefix: string, hash: string) =>
    prefix === RAW_KEY.slice(0, 16) && hash === KEY_HASH ? { ...KEY_IDENTITY } : null);
  mocks.incrementUsage.mockResolvedValue(undefined);
  mocks.admission.mockResolvedValue(null);
  mocks.claim.mockResolvedValue(null);
  mocks.deps.mockResolvedValue(preparedDeps);
  mocks.collectRun.mockImplementation(async (input: RunInput, opts?: { onStep?: (step: TraceStep) => void }) => {
    opts?.onStep?.(STEP);
    return completedRun(input);
  });
  mocks.outbound.mockImplementation(() => { throw new Error("No outbound transport in OpenAI ownership fixture"); });
  vi.stubGlobal("fetch", mocks.outbound);
});
afterEach(() => {
  try { expect(mocks.outbound).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

function assertInput(owned: boolean) {
  expect(mocks.collectRun).toHaveBeenCalledOnce();
  const input = mocks.collectRun.mock.calls[0][0] as RunInput;
  expect(input).toEqual({ question: QUESTION, budget: owned ? 0.5 : 0.03,
    queryId: expect.any(String), origin: owned ? "a2a" : "web", model: undefined,
    scholarly: false, researchMode: "deep", ...(owned ? { asker: KEY_OWNER } : {}),
    provenance: owned ? API_PROVENANCE : UNKNOWN_PROVENANCE,
    signal: expect.any(AbortSignal), onCreatorPaymentBoundary: expect.any(Function), onQueryRunSaveBoundary: expect.any(Function) });
  expect(mocks.deps).toHaveBeenCalledExactlyOnceWith({ model: undefined });
  for (const field of ["payer", "walletAddress", "mcpClient", "userAgent", "ip", "fundingOwner", "askerFunded"])
    expect(input).not.toHaveProperty(field);
  expect(mocks.admission).toHaveBeenCalledExactlyOnceWith(owned
    ? { kind: "key", wallet: KEY_OWNER, ip: "192.0.2.26" }
    : { kind: "anonymous", ip: "192.0.2.26" });
  expect(mocks.claim).toHaveBeenCalledExactlyOnceWith(input.queryId, owned ? KEY_OWNER : undefined);
  if (owned) {
    expect(mocks.lookupKey).toHaveBeenCalledExactlyOnceWith(RAW_KEY.slice(0, 16), KEY_HASH);
    expect(mocks.incrementUsage).toHaveBeenCalledExactlyOnceWith(KEY_IDENTITY.keyId);
  } else {
    expect(input).not.toHaveProperty("asker");
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.lookupKey).not.toHaveBeenCalled();
    expect(mocks.incrementUsage).not.toHaveBeenCalled();
  }
  return input;
}

async function assertCompletion(response: Response, stream: boolean, owned: boolean) {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const wire = await response.text();
  const input = assertInput(owned);
  const chunks = stream ? wire.split("\n\n").filter(part => part.startsWith("data: {"))
    .map(part => JSON.parse(part.slice(6))) : [];
  const final = stream ? chunks.at(-1) : JSON.parse(wire);
  if (stream) {
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(wire.endsWith("data: [DONE]\n\n")).toBe(true);
    expect(chunks).toHaveLength(4);
    expect(chunks[0].choices[0].delta).toEqual({ role: "assistant" });
    expect(chunks[1].choices[0].delta).toEqual({ reasoning_content: `[decompose] ${STEP.message}\n` });
    expect(chunks[2].choices[0].delta.content).toBe(completedRun(input).answer);
    expect(final).toMatchObject({ object: "chat.completion.chunk", choices: [{ delta: {}, finish_reason: "stop" }] });
    expect(mocks.collectRun.mock.calls[0][1]).toEqual({ deps: preparedDeps, onStep: expect.any(Function) });
  } else {
    expect(final).toMatchObject({ object: "chat.completion", choices: [{
      message: { role: "assistant", content: completedRun(input).answer }, finish_reason: "stop",
    }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    expect(mocks.collectRun.mock.calls[0][1]).toEqual({ deps: preparedDeps, onStep: expect.any(Function) });
  }
  expect(final).toMatchObject({ id: `chatcmpl-${input.queryId}`, model: "keryx", keryx: {
    queryId: input.queryId, provenance: owned ? API_PROVENANCE : UNKNOWN_PROVENANCE,
    totalToCreators: 0, paymentMode: "offline", creatorsPaid: null,
  } });
  expect(final).not.toHaveProperty("keryx_private");
  for (const field of ["asker", "payer", "walletAddress", "keyId", "fundingOwner", "askerFunded", "mcpClient"]) {
    expect(final).not.toHaveProperty(field);
    expect(final.keryx).not.toHaveProperty(field);
  }
  for (const privateValue of [RAW_KEY, KEY_HASH, KEY_IDENTITY.keyId, KEY_OWNER, FORGED_OWNER, DECLARED_PAYER])
    expect(wire).not.toContain(privateValue);
}

it.each([false, true].flatMap(stream => ["desktop", "extension"].map(client => [stream, client] as const)))
  ("keeps verified key ownership separate from forged payer/client metadata: stream=%s client=%s", async (stream, client) => {
    await assertCompletion(await POST(request(stream, RAW_KEY, client)), stream, true);
  });

it.each([false, true])("retains the verified owner at collection when research refuses: stream=%s", async stream => {
  const failure = new ResearchPlanningError(QUESTION, "invalid_output");
  const message = researchFailureMessage(failure);
  mocks.collectRun.mockImplementation(async (_input: RunInput, opts?: { onStep?: (step: TraceStep) => void }) => {
    opts?.onStep?.(STEP);
    throw failure;
  });
  const response = await POST(request(stream));
  const wire = await response.text();
  assertInput(true);
  if (stream) {
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const chunks = wire.trim().split("\n\n").map(part => JSON.parse(part.slice(6)));
    expect(chunks).toHaveLength(3);
    expect(chunks.at(-1).choices[0].delta.content).toBe(`\n\n[keryx error] ${message}`);
    for (const chunk of chunks) {
      expect(chunk.choices[0].finish_reason).toBeNull();
      expect(chunk).not.toHaveProperty("keryx");
      expect(chunk).not.toHaveProperty("keryx_private");
    }
    expect(wire).not.toContain("data: [DONE]");
  } else {
    expect(response.status).toBe(422);
    expect(JSON.parse(wire)).toEqual({ error: { message,
      type: "invalid_request_error", code: "research_plan_refinement_required", reportSaved: false,
      planningFailure: { version: 1, stage: "decompose", reason: "invalid_output", maximumTargets: 8, automaticRetry: false } } });
  }
  for (const privateValue of [RAW_KEY, KEY_OWNER, FORGED_OWNER, DECLARED_PAYER]) expect(wire).not.toContain(privateValue);
});

const invalidKeys = [
  { name: "malformed Keryx key", key: "kx_live_synthetic-invalid", lookup: false },
  { name: "missing lookup row", key: `kx_live_${"3".repeat(96)}`, lookup: true },
  { name: "same-prefix wrong digest", key: `${RAW_KEY.slice(0, -1)}2`, lookup: true },
  { name: "lookup returns no identity", key: RAW_KEY, lookup: true, noIdentity: true },
] as const;
it.each(invalidKeys.flatMap(value => [false, true].map(stream => ({ ...value, stream }))))
  ("refuses $name before admission, claims or collection: stream=$stream", async value => {
    if ("noIdentity" in value) mocks.lookupKey.mockResolvedValue(null);
    const response = await POST(request(value.stream, value.key));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { message: "invalid or revoked api key",
      type: "invalid_request_error", code: "invalid_api_key" } });
    if (value.lookup) {
      expect(mocks.lookupKey).toHaveBeenCalledExactlyOnceWith(value.key.slice(0, 16),
        createHash("sha256").update(value.key).digest("hex"));
    } else {
      expect(mocks.getDb).not.toHaveBeenCalled();
      expect(mocks.lookupKey).not.toHaveBeenCalled();
    }
    expect(mocks.admission).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.incrementUsage).not.toHaveBeenCalled();
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

it.each([false, true])("does not reuse a previously verified identity after lookup reports revocation: stream=%s", async stream => {
  await assertCompletion(await POST(request(stream)), stream, true);
  mocks.lookupKey.mockResolvedValue(null); // Synthetic DB revocation result; no real key/store mutation.
  for (const mock of [mocks.admission, mocks.claim, mocks.incrementUsage, mocks.collectRun]) mock.mockClear();
  const response = await POST(request(stream));
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: "invalid_api_key" } });
  expect(mocks.lookupKey).toHaveBeenCalledTimes(2);
  for (const mock of [mocks.admission, mocks.claim, mocks.incrementUsage, mocks.collectRun]) expect(mock).not.toHaveBeenCalled();
});

it.each([false, true])("an export-only verified key cannot start research or acquire ask authority from metadata: stream=%s", async stream => {
  mocks.lookupKey.mockResolvedValue({ ...KEY_IDENTITY, scopes: "export" });
  const response = await POST(request(stream));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: { message: "this api key is not scoped for ask",
    type: "invalid_request_error", code: "insufficient_scope" } });
  expect(mocks.lookupKey).toHaveBeenCalledExactlyOnceWith(RAW_KEY.slice(0, 16), KEY_HASH);
  for (const mock of [mocks.admission, mocks.claim, mocks.incrementUsage, mocks.collectRun]) expect(mock).not.toHaveBeenCalled();
});

// Missing/placeholder Authorization deliberately retains the existing anonymous
// tier. A client header (including x-api-key) cannot upgrade it or create an owner.
it.each([false, true].flatMap(stream => [null, "not-needed"].map(key => [stream, key] as const)))
  ("leaves an admitted anonymous caller ownerless despite client headers: stream=%s token=%s", async (stream, key) => {
    await assertCompletion(await POST(request(stream, key)), stream, false);
  });

it.each([false, true])("refuses an unidentified caller at sponsored admission before collection: stream=%s", async stream => {
  mocks.admission.mockResolvedValue(Response.json({ error: "sponsored_admission_unavailable", retryAfter: 60 },
    { status: 503, headers: { "Retry-After": "60" } }));
  const response = await POST(request(stream, null));
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(await response.json()).toEqual({ error: "sponsored_admission_unavailable", retryAfter: 60 });
  expect(mocks.admission).toHaveBeenCalledExactlyOnceWith({ kind: "anonymous", ip: "192.0.2.26" });
  for (const mock of [mocks.getDb, mocks.lookupKey, mocks.incrementUsage, mocks.claim, mocks.collectRun]) expect(mock).not.toHaveBeenCalled();
});
