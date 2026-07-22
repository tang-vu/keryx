/** Citation email alerts — the pure parts: address check, rate cap, and mail content. */

import { describe, expect, it } from "vitest";
import {
  buildCitationEmailContent,
  isValidAlertEmail,
  shouldSendEmail,
} from "./citation-email";
import { CITATION_EVENT, type CitationWebhookPayload } from "./citation-webhook";

const HOUR = 60 * 60_000;

function payload(over: Partial<CitationWebhookPayload> = {}): CitationWebhookPayload {
  return {
    event: CITATION_EVENT,
    deliveryId: "d-1",
    timestamp: "2026-07-23T00:00:00.000Z",
    source: { id: "src-1", name: "Agent Economy Weekly" },
    query: { id: "q-1", question: "How do x402 tolls work?" },
    weight: 0.6,
    amountUsdc: 0.015,
    network: "arcTestnet",
    payments: [{ payee: "0xabc", amountUsdc: 0.015, txHash: "0xdead", settled: true }],
    ...over,
  };
}

describe("isValidAlertEmail", () => {
  it("accepts a plain address and rejects junk", () => {
    expect(isValidAlertEmail("mara@example.com")).toBe(true);
    expect(isValidAlertEmail("not-an-email")).toBe(false);
    expect(isValidAlertEmail("two words@example.com")).toBe(false);
    expect(isValidAlertEmail("a@b")).toBe(false); // no TLD dot
    expect(isValidAlertEmail(`${"x".repeat(250)}@example.com`)).toBe(false); // over 254
  });
});

describe("shouldSendEmail (rate cap)", () => {
  const now = Date.parse("2026-07-23T12:00:00.000Z");

  it("sends when there is no prior delivery", () => {
    expect(shouldSendEmail(null, now, HOUR)).toBe(true);
  });

  it("holds inside the interval, releases after it", () => {
    const halfHourAgo = new Date(now - HOUR / 2).toISOString();
    const twoHoursAgo = new Date(now - 2 * HOUR).toISOString();
    expect(shouldSendEmail(halfHourAgo, now, HOUR)).toBe(false);
    expect(shouldSendEmail(twoHoursAgo, now, HOUR)).toBe(true);
  });

  it("fails open on an unparseable timestamp", () => {
    expect(shouldSendEmail("not-a-date", now, HOUR)).toBe(true);
  });
});

describe("buildCitationEmailContent", () => {
  const content = buildCitationEmailContent(payload(), {
    base: "https://keryx.cc",
    unsubToken: "tok123",
  });

  it("carries the question, amount, and source in subject + bodies", () => {
    expect(content.subject).toContain("Agent Economy Weekly");
    expect(content.subject).toContain("$0.015");
    for (const body of [content.html, content.text]) {
      expect(body).toContain("How do x402 tolls work?");
      expect(body).toContain("$0.015");
      expect(body).toContain("60%");
    }
  });

  it("links the dispatch trace, earnings page, and tokened unsubscribe", () => {
    for (const body of [content.html, content.text]) {
      expect(body).toContain("https://keryx.cc/dispatch/q-1");
      expect(body).toContain("https://keryx.cc/creator/src-1");
      expect(body).toContain("/api/notify/unsubscribe?sid=src-1&t=tok123");
    }
  });

  it("escapes HTML in creator-controlled strings", () => {
    const hostile = buildCitationEmailContent(
      payload({
        source: { id: "src-1", name: `<img src=x onerror=alert(1)>` },
        query: { id: "q-1", question: `<script>steal()</script>` },
      }),
      { base: "https://keryx.cc", unsubToken: "tok123" },
    );
    expect(hostile.html).not.toContain("<img");
    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).toContain("&lt;script&gt;");
  });
});
