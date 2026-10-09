import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OperatorBusinessStatus } from "./contracts";

const reader = vi.hoisted(() => ({
  index: 0,
  status: null as OperatorBusinessStatus | null,
  readState: "loading",
  effects: [] as (() => () => void)[],
}));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => () => void) => { reader.effects.push(effect); },
  useState: () => {
    const index = reader.index++;
    return index === 0
      ? [reader.status, (status: OperatorBusinessStatus | null) => { reader.status = status; }]
      : [reader.readState, (state: string) => { reader.readState = state; }];
  },
}));
import { OperatorBusinessSnapshot, OperatorBusinessView } from "../../components/keryx/operator-business-view";
import { OPERATOR_REASON_TEXT } from "./contracts";
import { summarizeA2aOperations } from "../a2a/operations";
import { completionFixtureRows, COMPLETION_FIXTURE_NOW } from "../a2a/completion-latency.test-support";

const status = (): OperatorBusinessStatus => ({
  version: 1,
  network: "eip155:5042",
  operator: {
    state: "working", observedAt: "2026-10-06T01:00:00.000Z", auditRecorded: true,
    decision: { action: "run-next", reason: "liquidity-covered", liquidity: "covered", observedAt: "2026-10-06T01:00:00.000Z" },
  },
  jobs: {
    queued: 3, processing: 1, reviewRequired: 2,
    completedLast24h: 4, failedLast24h: 1, completionRateLast24h: 0.8,
    oldestQueuedAgeSeconds: 125, oldestProcessingAgeSeconds: 60,
    completionLatencyP50Ms: 4_000, completionLatencyP95Ms: 6_000, degraded: true,
    completionLatencyCohorts: null,
  },
  creatorCatalog: { registered: 0 },
});
const render = (value: OperatorBusinessStatus | null, readState?: "loading" | "ready" | "unavailable") => renderToStaticMarkup(createElement(OperatorBusinessSnapshot, { status: value, readState }));

beforeEach(() => { reader.index = 0; reader.status = null; reader.readState = "loading"; reader.effects = []; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("public Operator view", () => {
  it("renders separate recorded timing paths and exposes neither private markers nor a settlement claim", () => {
    const value = status(); value.jobs = summarizeA2aOperations(completionFixtureRows(), COMPLETION_FIXTURE_NOW, true);
    const html = render(value);
    for (const text of ["Completion timing by recorded path", "Ordinary", "Recovered", "Unknown path", "2d 4h", "Timed samples", "95th percentile", "first answer", "Acceptance to recorded completion/update", "for orders recorded as completed and updated in the last 24 hours", "Later reconciliation can extend this time"]) expect(html).toContain(text);
    expect(html).toContain('scope="col"'); expect(html).toContain('scope="row"'); expect(html).toContain('overflow-x-auto');
    expect(html).not.toMatch(/claimId|authoritySha256|originalFailureSha256|Synthetic timing fixture/);
  });
  it("keeps a legacy storage response's missing capability explicit instead of ordinary zero latency", () => {
    const html = render(status());
    expect(html).toContain("Completion-path timing is unavailable on this storage contract");
    expect(html).toContain("Missing capability is not zero ordinary latency");
  });
  it.each(["disabled", "idle", "working", "held", "review", "stale", "unavailable"] as const)("renders the observed %s state", state => {
    const value = status(); value.operator.state = state;
    const expected = {
      disabled: "Disabled", idle: "Active · idle", working: "Active · working", held: "Held",
      review: "Review required", stale: "Observation stale", unavailable: "Unknown",
    }[state];
    const html = render(value);
    expect(html).toContain(expected);
    expect(html).toContain("Arc mainnet");
    expect(html).toContain(OPERATOR_REASON_TEXT["liquidity-covered"]);
  });

  it("keeps unknown queue, catalog and audit separate from zero activity", () => {
    const html = render(null, "unavailable");
    expect(html).toContain("The queue is unknown");
    expect(html).toContain("The catalog count is unknown");
    expect(html).toContain("Previous counts are hidden");
    expect(html).not.toContain("No terminal order outcomes");
    expect(html).not.toContain("No registered creator source is observed");
    expect(html).not.toContain(">Recorded<");
  });

  it("reports zero outcomes without inventing a success rate or demand", () => {
    const value = status();
    value.jobs = { ...value.jobs!, queued: 0, processing: 0, reviewRequired: 0, completedLast24h: 0, failedLast24h: 0, completionRateLast24h: null, degraded: false };
    const html = render(value);
    expect(html).toContain("No terminal order outcomes are recorded");
    expect(html).toContain("does not establish demand or a success rate");
    expect(html).toContain("No registered creator source is observed");
    expect(html).not.toContain("100%");
  });

  it("does not turn an observed decision into a durable audit claim", () => {
    const value = status(); value.operator.auditRecorded = false;
    const html = render(value);
    expect(html).toContain("Not recorded");
    expect(html).toContain("does not confirm a durable audit entry");
    expect(html).not.toContain(">Recorded<");
  });

  it("shows only the public projection and original-authority boundaries", () => {
    const value = { ...status(), signer: "PRIVATE_SIGNER", orderId: "PRIVATE_ORDER", question: "PRIVATE_QUESTION", balance: "PRIVATE_BALANCE", costs: "PRIVATE_COSTS" };
    const html = render(value);
    for (const secret of [value.signer, value.orderId, value.question, value.balance, value.costs]) expect(html).not.toContain(secret);
    expect(html).toContain('href="/research#paid-research"');
    expect(html).toContain('href="/sources"');
    expect(html).toContain("remain separate gates");
    expect(html).not.toContain("<button");
  });

  it("preserves the observed testnet without relabelling it as mainnet", () => {
    const value = status(); value.network = "eip155:5042002";
    const html = render(value);
    expect(html).toContain("Arc testnet"); expect(html).not.toContain("Arc mainnet");
  });
});

describe("public status reader", () => {
  it.each(["transport", "refusal", "invalid", "unknown-network"])("clears a previous working snapshot on a %s failure", async failure => {
    reader.status = status(); reader.readState = "ready";
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (failure === "transport") throw new Error("unavailable");
      if (failure === "refusal") return Response.json({ error: "unavailable" }, { status: 503 });
      if (failure === "unknown-network") return Response.json({ ...status(), network: "eip155:12345" });
      return Response.json({ version: 1, operator: { state: "working" } });
    }));
    const previous = renderToStaticMarkup(createElement(OperatorBusinessView));
    expect(previous).toContain("Active · working");
    const cleanup = reader.effects[0]();
    try {
      await vi.waitFor(() => expect(reader.readState).toBe("unavailable"));
      expect(reader.status).toBeNull();
      reader.index = 0;
      const html = renderToStaticMarkup(createElement(OperatorBusinessView));
      expect(html).not.toContain("Active · working");
      expect(html).toContain("The queue is unknown");
    } finally { cleanup(); }
  });

  it("requests only the unauthenticated GET public snapshot", async () => {
    const fetch = vi.fn(async () => Response.json(status())); vi.stubGlobal("fetch", fetch);
    renderToStaticMarkup(createElement(OperatorBusinessView));
    const cleanup = reader.effects[0]();
    try {
      await vi.waitFor(() => expect(reader.readState).toBe("ready"));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]).toEqual(["/api/operator/status", expect.objectContaining({ cache: "no-store", credentials: "omit" })]);
      expect(reader.status?.jobs?.queued).toBe(3);
    } finally { cleanup(); }
  });
});
