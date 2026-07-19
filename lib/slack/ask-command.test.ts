/**
 * Unit tests for the Slack front door's pure layer: real HMAC-SHA256 sign/verify round-trips
 * (Slack probes the endpoint with bad and stale signatures, so rejection paths matter as much as
 * acceptance) and the slash-command ↔ Keryx shape mappers the route depends on.
 */

import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyRequestSignature } from "./verify-request-signature";
import {
  type SlashCommand,
  parseSlashCommand,
  helpText,
  buildAnswerText,
  buildErrorText,
} from "./ask-command";
import type { QueryRun } from "../types";

// ── Signature verification ──

describe("verifyRequestSignature", () => {
  const secret = "8f742231b10e8888abcd99yyyzzz85a5";
  const body = "command=/keryx&text=What+is+x402%3F&user_id=U123";
  const nowSec = () => Math.floor(Date.now() / 1000);
  const sign = (ts: number, b = body, s = secret) =>
    "v0=" + createHmac("sha256", s).update(`v0:${ts}:${b}`).digest("hex");

  it("accepts a genuine signature within the timestamp window", () => {
    const ts = nowSec();
    expect(verifyRequestSignature(secret, sign(ts), String(ts), body)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ts = nowSec();
    expect(verifyRequestSignature(secret, sign(ts), String(ts), body + "&x=1")).toBe(false);
  });

  it("rejects a stale timestamp even with an otherwise-valid signature", () => {
    const ts = nowSec() - 600; // 10 min old — beyond Slack's 5 min replay window
    expect(verifyRequestSignature(secret, sign(ts), String(ts), body)).toBe(false);
  });

  it("rejects a wrong secret and malformed inputs without throwing", () => {
    const ts = nowSec();
    expect(verifyRequestSignature(secret, sign(ts, body, "wrong"), String(ts), body)).toBe(false);
    expect(verifyRequestSignature(secret, "deadbeef", String(ts), body)).toBe(false);
    expect(verifyRequestSignature(secret, "", "", "")).toBe(false);
  });
});

// ── Slash-command parsing ──

function params(overrides: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    command: "/keryx",
    text: "What is x402?",
    user_id: "U123",
    channel_id: "C456",
    response_url: "https://hooks.slack.com/commands/T0/123/abc",
    ...overrides,
  });
}

describe("parseSlashCommand", () => {
  it("extracts question, user, channel, response url, and command", () => {
    expect(parseSlashCommand(params())).toEqual<SlashCommand>({
      question: "What is x402?",
      userId: "U123",
      channelId: "C456",
      responseUrl: "https://hooks.slack.com/commands/T0/123/abc",
      command: "/keryx",
    });
  });

  it("trims the question and keeps a multi-line question intact", () => {
    expect(parseSlashCommand(params({ text: "  padded?  " }))?.question).toBe("padded?");
    expect(parseSlashCommand(params({ text: "line one\nline two" }))?.question).toBe(
      "line one\nline two",
    );
  });

  it("returns null when the text is empty, whitespace, or absent", () => {
    expect(parseSlashCommand(params({ text: "" }))).toBeNull();
    expect(parseSlashCommand(params({ text: "   " }))).toBeNull();
    expect(parseSlashCommand(new URLSearchParams())).toBeNull();
  });

  it("falls back to a shared bucket when the user id is missing", () => {
    expect(parseSlashCommand(params({ user_id: "" }))?.userId).toBe("unknown");
  });
});

// ── Message building ──

function fakeRun(overrides: Partial<QueryRun> = {}): QueryRun {
  return {
    id: "run-1",
    question: "What is x402?",
    budget: 0.05,
    engine: "heuristic",
    subClaims: [],
    decisions: [],
    citations: [
      { marker: "S1", sourceId: "s1", sourceName: "Conzit", weight: 0.6, reward: 0.012, rationale: "primary" },
      { marker: "S2", sourceId: "s2", sourceName: "Docs", weight: 0.4, reward: 0.008, rationale: "support" },
    ],
    answer: "x402 is an HTTP payment protocol.",
    totalSpent: 0.03,
    totalToCreators: 0.02,
    trace: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("message builders", () => {
  it("builds bold question, answer, creators-paid block, totals, and dispatch link", () => {
    const text = buildAnswerText(fakeRun());
    expect(text).toContain("*What is x402?*");
    expect(text).toContain("HTTP payment protocol");
    expect(text).toContain("Conzit — $0.0120 (weight 0.60)");
    expect(text).toContain("2 creators paid");
    expect(text).toContain("/dispatch/run-1");
  });

  it("escapes Slack's reserved chars so creator text can't inject markup", () => {
    const text = buildAnswerText(
      fakeRun({
        answer: "a <script> & such",
        citations: [
          { marker: "S1", sourceId: "s1", sourceName: "<b>Evil</b>", weight: 1, reward: 0.01, rationale: "" },
        ],
      }),
    );
    expect(text).toContain("a &lt;script&gt; &amp; such");
    expect(text).toContain("&lt;b&gt;Evil&lt;/b&gt; — $0.0100");
    expect(text).not.toContain("<script>");
  });

  it("omits the creators block when nothing was cited, and stays bounded", () => {
    const text = buildAnswerText(fakeRun({ citations: [], answer: "a".repeat(20000) }));
    expect(text).not.toContain("Creators paid");
    expect(text).toContain("0 creators paid");
    expect(text.length).toBeLessThanOrEqual(12000);
  });

  it("help text carries usage and the status link, error text is escaped", () => {
    expect(helpText()).toContain("/keryx");
    expect(helpText()).toContain("/status");
    expect(buildErrorText(new Error("boom <tag>"))).toContain("boom &lt;tag&gt;");
  });
});
