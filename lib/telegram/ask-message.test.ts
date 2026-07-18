/**
 * Unit tests for the Telegram front door's pure layer: update parsing (command forms, DM
 * plain-text, bot-loop guard) and the HTML answer/help builders the webhook route depends on.
 */

import { describe, expect, it } from "vitest";
import {
  type TelegramUpdate,
  parseAskMessage,
  isHelpCommand,
  helpText,
  apiUrl,
  buildAnswerText,
  buildErrorText,
} from "./ask-message";
import type { QueryRun } from "../types";

// ── Update parsing ──

function askUpdate(overrides: Partial<NonNullable<TelegramUpdate["message"]>> = {}): TelegramUpdate {
  return {
    message: {
      message_id: 42,
      text: "/ask What is x402?",
      chat: { id: -100123, type: "group" },
      from: { id: 789, is_bot: false },
      ...overrides,
    },
  };
}

describe("parseAskMessage", () => {
  it("extracts question, chat, user, and message id from a group /ask", () => {
    expect(parseAskMessage(askUpdate())).toEqual({
      question: "What is x402?",
      chatId: -100123,
      userId: 789,
      messageId: 42,
    });
  });

  it("strips the @BotName suffix groups append to commands", () => {
    const cmd = parseAskMessage(askUpdate({ text: "/ask@KeryxHeraldBot   padded?  " }));
    expect(cmd?.question).toBe("padded?");
  });

  it("treats plain text as the question in a private chat, but not in a group", () => {
    const dm = askUpdate({ text: "just a question", chat: { id: 7, type: "private" } });
    expect(parseAskMessage(dm)?.question).toBe("just a question");
    expect(parseAskMessage(askUpdate({ text: "just a question" }))).toBeNull();
  });

  it("keeps a multi-line question intact", () => {
    const cmd = parseAskMessage(askUpdate({ text: "/ask line one\nline two" }));
    expect(cmd?.question).toBe("line one\nline two");
  });

  it("returns null for bare /ask, other commands, other bots, and shapeless updates", () => {
    expect(parseAskMessage(askUpdate({ text: "/ask" }))).toBeNull();
    expect(parseAskMessage(askUpdate({ text: "/start" }))).toBeNull();
    expect(parseAskMessage(askUpdate({ from: { id: 1, is_bot: true } }))).toBeNull();
    expect(parseAskMessage({})).toBeNull();
    expect(parseAskMessage({ message: { text: "/ask q" } })).toBeNull(); // no chat/from ids
  });
});

describe("isHelpCommand", () => {
  it("matches /start and /help with or without a bot suffix, nothing else", () => {
    expect(isHelpCommand(askUpdate({ text: "/start" }))).toBe(true);
    expect(isHelpCommand(askUpdate({ text: "/help@KeryxHeraldBot" }))).toBe(true);
    expect(isHelpCommand(askUpdate({ text: "/ask q" }))).toBe(false);
    expect(isHelpCommand({})).toBe(false);
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
  it("builds bold question, answer, creators-paid block, and dispatch link", () => {
    const text = buildAnswerText(fakeRun());
    expect(text).toContain("<b>What is x402?</b>");
    expect(text).toContain("HTTP payment protocol");
    expect(text).toContain("Conzit — $0.0120 (weight 0.60)");
    expect(text).toContain("2 creators paid");
    expect(text).toContain("/dispatch/run-1");
  });

  it("escapes HTML in creator-controlled text so parse_mode HTML can't be broken", () => {
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

  it("omits the creators block when nothing was cited, and stays under Telegram's cap", () => {
    const text = buildAnswerText(fakeRun({ citations: [], answer: "a".repeat(6000) }));
    expect(text).not.toContain("Creators paid");
    expect(text).toContain("0 creators paid");
    expect(text.length).toBeLessThanOrEqual(4096);
  });

  it("help text is HTML-safe and carries usage plus the status link", () => {
    expect(helpText()).toContain("/ask");
    expect(helpText()).toContain("/status");
  });

  it("formats API URLs and error text", () => {
    expect(apiUrl("123:abc", "sendMessage")).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(buildErrorText(new Error("boom <tag>"))).toContain("boom &lt;tag&gt;");
  });
});
