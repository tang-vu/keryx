/**
 * Unit tests for the Discord front door's pure layer: real Ed25519 sign/verify round-trips
 * (Discord's endpoint-validation probe sends bad signatures, so rejection paths matter as much
 * as acceptance) and the interaction ↔ Keryx shape mappers the route depends on.
 */

import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyInteractionSignature } from "./verify-interaction-signature";
import {
  type Interaction,
  parseAskCommand,
  pong,
  deferredResponse,
  ephemeralReply,
  followupUrl,
  buildAnswerMessage,
  buildErrorMessage,
} from "./ask-interaction";
import type { QueryRun } from "../types";

// ── Signature verification ──

function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // Raw 32-byte key = SPKI DER minus its fixed 12-byte header — the format Discord's portal shows.
  const publicKeyHex = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(12)
    .toString("hex");
  return { publicKeyHex, privateKey };
}

describe("verifyInteractionSignature", () => {
  const { publicKeyHex, privateKey } = makeKeyPair();
  const timestamp = "1721200000";
  const body = JSON.stringify({ type: 1 });
  const signatureHex = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

  it("accepts a genuine signature over timestamp+body", () => {
    expect(verifyInteractionSignature(publicKeyHex, signatureHex, timestamp, body)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(
      verifyInteractionSignature(publicKeyHex, signatureHex, timestamp, body + " "),
    ).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const other = makeKeyPair();
    const forged = sign(null, Buffer.from(timestamp + body), other.privateKey).toString("hex");
    expect(verifyInteractionSignature(publicKeyHex, forged, timestamp, body)).toBe(false);
  });

  it("rejects malformed inputs without throwing", () => {
    expect(verifyInteractionSignature("zz", signatureHex, timestamp, body)).toBe(false);
    expect(verifyInteractionSignature(publicKeyHex, "deadbeef", timestamp, body)).toBe(false);
    expect(verifyInteractionSignature("", "", "", "")).toBe(false);
  });
});

// ── Interaction parsing ──

function askInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    type: 2,
    application_id: "app123",
    token: "tok456",
    data: { name: "ask", options: [{ name: "question", value: "What is x402?" }] },
    member: { user: { id: "user789" } },
    ...overrides,
  };
}

describe("parseAskCommand", () => {
  it("extracts question, user, and routing ids from a guild invocation", () => {
    const cmd = parseAskCommand(askInteraction());
    expect(cmd).toMatchObject({
      question: "What is x402?",
      userId: "user789",
      applicationId: "app123",
      token: "tok456",
    });
    expect(cmd?.budget).toBeUndefined();
  });

  it("reads the optional budget and the DM-style user field", () => {
    const cmd = parseAskCommand(
      askInteraction({
        member: undefined,
        user: { id: "dm-user" },
        data: {
          name: "ask",
          options: [
            { name: "question", value: "  padded?  " },
            { name: "budget", value: 0.03 },
          ],
        },
      }),
    );
    expect(cmd).toMatchObject({ question: "padded?", budget: 0.03, userId: "dm-user" });
  });

  it("returns null for pings, other commands, and empty questions", () => {
    expect(parseAskCommand({ type: 1 })).toBeNull();
    expect(parseAskCommand(askInteraction({ data: { name: "other", options: [] } }))).toBeNull();
    expect(
      parseAskCommand(
        askInteraction({ data: { name: "ask", options: [{ name: "question", value: "  " }] } }),
      ),
    ).toBeNull();
    expect(parseAskCommand(askInteraction({ token: undefined }))).toBeNull();
  });

  it("ignores a non-numeric budget instead of failing the command", () => {
    const cmd = parseAskCommand(
      askInteraction({
        data: {
          name: "ask",
          options: [
            { name: "question", value: "q" },
            { name: "budget", value: "lots" },
          ],
        },
      }),
    );
    expect(cmd?.budget).toBeUndefined();
  });
});

// ── Response building ──

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

describe("response builders", () => {
  it("pong/deferred/ephemeral carry Discord's callback types and flags", () => {
    expect(pong()).toEqual({ type: 1 });
    expect(deferredResponse()).toEqual({ type: 5 });
    const eph = ephemeralReply("nope");
    expect(eph.type).toBe(4);
    expect(eph.data.flags).toBe(64);
  });

  it("builds an embed with answer, creators-paid field, and dispatch link", () => {
    const msg = buildAnswerMessage(fakeRun());
    const embed = msg.embeds[0]!;
    expect(embed.title).toBe("What is x402?");
    expect(embed.description).toContain("HTTP payment protocol");
    expect(embed.url).toContain("/dispatch/run-1");
    expect(embed.fields[0]!.value).toContain("Conzit — $0.0120 (weight 0.60)");
    expect(embed.footer.text).toContain("2 creators paid");
  });

  it("omits the creators field when nothing was cited, and truncates a huge answer", () => {
    const msg = buildAnswerMessage(fakeRun({ citations: [], answer: "a".repeat(5000) }));
    const embed = msg.embeds[0]!;
    expect(embed.fields).toHaveLength(0);
    expect(embed.description.length).toBeLessThanOrEqual(3500);
    expect(embed.description.endsWith("…")).toBe(true);
  });

  it("formats follow-up URL and error message", () => {
    expect(followupUrl("a", "t")).toBe(
      "https://discord.com/api/v10/webhooks/a/t/messages/@original",
    );
    expect(buildErrorMessage(new Error("boom")).content).toContain("boom");
  });
});
