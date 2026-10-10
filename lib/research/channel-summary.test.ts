import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { replayExtensionPopup } from "../display/extension-popup.test-fixture";
import { buildAnswerText as slack } from "../slack/ask-command";
import { buildAnswerText as telegram } from "../telegram/ask-message";
import { buildAnswerMessage as discord } from "../discord/ask-interaction";
import type { QueryRun } from "../types";

it.each(["real", "offline"] as const)("thin channel summaries separate public citations from payment claims (%s)", paymentMode => {
  const run: QueryRun = { id: "q", question: "Question?", budget: 0.03, engine: "heuristic", answer: "Public answer",
    subClaims: [], decisions: [], citations: [{ marker: "P1", sourceId: "public", sourceName: "Public publisher",
      sourceKind: "public-reference", reward: 0, weight: 1, rationale: "read" }],
    totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-01T00:00:00Z", paymentMode };
  for (const text of [slack(run), telegram(run), JSON.stringify(discord(run))]) {
    expect(text).toContain("planned rewards");
    expect(text).toContain(paymentMode);
    expect(text).not.toMatch(/creator[s]? paid|Creators paid/);
    expect(text).toContain("Public publisher");
  }
});

it("the actual extension stream renderer marks allocations and offline state without claiming settlement", async () => {
  const chunk = { choices: [{ delta: {}, finish_reason: "stop" }],
    keryx: { citations: [{ source: "Public publisher", reward: 0 }], totalToCreators: 0, paymentMode: "offline" } };
  await replayExtensionPopup([chunk], document => {
    expect(document.getElementById("paid-panel")!.hidden).toBe(false);
    expect(document.getElementById("status")!.textContent).toContain("offline");
    expect(document.getElementById("status")!.textContent).toContain("not settlement proof");
  });
  expect(readFileSync("extension/popup.html", "utf8")).not.toMatch(/Creators paid|settled in USDC/);
});
