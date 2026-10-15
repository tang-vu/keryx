/** Citation email alerts — the pure parts: address check, rate cap, and mail content. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCitationEmailContent,
  dispatchCitationEmail,
  isValidAlertEmail,
  shouldSendEmail,
} from "./citation-email";
import { CITATION_EVENT, type CitationWebhookPayload } from "./citation-webhook";
import { recipientLanguageKey } from "./recipient-language";
import { citationEmailUnreviewedDraftMessages } from "./citation-messages";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentRecord, Source } from "../types";
import type { PresentationLanguage } from "../research/presentation-language";

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
  it.each(["en", "vi", "pt", "es"] as const)("localizes %s navigation while retaining original financial facts", async language => {
    const { citationEmailMessages } = await import("./citation-messages");
    const content = buildCitationEmailContent(payload(), { base: "https://keryx.cc", unsubToken: "tok123", language });
    expect(content.text).toContain(citationEmailMessages[language].trace);
    expect(content.html).toContain(citationEmailMessages[language].unsubscribe);
    expect(content.subject).toContain("$0.015 USDC");
    expect(content.text).toContain("arcTestnet");
    expect(content.text).not.toContain("How do x402 tolls work?");
  });
  const content = buildCitationEmailContent(payload(), {
    base: "https://keryx.cc",
    unsubToken: "tok123",
  });

  it("retains creator financial facts without delivering a reader's question", () => {
    expect(content.subject).toContain("Agent Economy Weekly");
    expect(content.subject).toContain("$0.015");
    for (const body of [content.html, content.text]) {
      expect(body).not.toContain("How do x402 tolls work?");
      expect(body).toContain("$0.015");
      expect(body).toContain("60%");
    }
  });

  it("links the dispatch trace, earnings page, and tokened unsubscribe", () => {
    for (const body of [content.html, content.text]) {
      expect(body).toContain("https://keryx.cc/dispatch/q-1");
      expect(body).toContain("https://keryx.cc/creator/src-1");
    }
    expect(content.text).toContain("/api/notify/unsubscribe?sid=src-1&t=tok123");
    expect(content.html).toContain("/api/notify/unsubscribe?sid=src-1&amp;t=tok123");
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
    expect(hostile.html).not.toContain("&lt;script&gt;");
  });
});

describe("recipient-selected wrappers", () => {
  const opts = { base: "https://keryx.cc", unsubToken: "tok123" };
  const cases = [
    {
      language: "en",
      subject: 'Keryx cited "Agent Economy Weekly" — $0.015 USDC settled to you',
      body: 'Your source "Agent Economy Weekly" was just cited by the Keryx agent and paid $0.015 USDC (60% contribution weight), settled on arcTestnet.',
      title: "Keryx &middot; citation settled",
      heading: "Agent Economy Weekly was cited &mdash; $0.015 USDC is yours",
      htmlBody: "The Keryx agent relied on your work (60% contribution weight) and settled $0.015 USDC to your wallet on arcTestnet.",
      rate: "You get at most one of these per source per hour — every payout, including the ones between emails, is on your earnings page.",
      htmlRate: "At most one alert per source per hour &mdash; every payout is on your earnings page.",
    },
    {
      language: "vi",
      subject: 'Keryx đã trích dẫn "Agent Economy Weekly" — $0.015 USDC đã được quyết toán cho bạn',
      body: 'Nguồn "Agent Economy Weekly" của bạn vừa được tác nhân Keryx trích dẫn và nhận $0.015 USDC (trọng số đóng góp 60%), đã quyết toán trên arcTestnet.',
      title: "Keryx &middot; thưởng trích dẫn đã quyết toán",
      heading: "Agent Economy Weekly đã được trích dẫn &mdash; bạn đã nhận $0.015 USDC",
      htmlBody: "Tác nhân Keryx đã sử dụng công trình của bạn (trọng số đóng góp 60%) và quyết toán $0.015 USDC vào ví của bạn trên arcTestnet.",
      rate: "Bạn nhận tối đa một thông báo cho mỗi nguồn mỗi giờ — mọi khoản chi trả, kể cả giữa các email, đều có trên trang thu nhập của bạn.",
      htmlRate: "Tối đa một thông báo cho mỗi nguồn mỗi giờ &mdash; mọi khoản chi trả đều có trên trang thu nhập của bạn.",
    },
    {
      language: "pt",
      subject: 'Keryx citou "Agent Economy Weekly" — $0.015 USDC liquidados para você',
      body: 'Sua fonte "Agent Economy Weekly" acaba de ser citada pelo agente Keryx e recebeu $0.015 USDC (peso de contribuição de 60%), liquidados na rede arcTestnet.',
      title: "Keryx &middot; recompensa de citação liquidada",
      heading: "Agent Economy Weekly foi citada &mdash; $0.015 USDC são seus",
      htmlBody: "O agente Keryx utilizou seu trabalho (peso de contribuição de 60%) e liquidou $0.015 USDC para sua carteira na rede arcTestnet.",
      rate: "Você recebe no máximo um aviso por fonte a cada hora — todos os pagamentos, inclusive os feitos entre os emails, estão na sua página de rendimentos.",
      htmlRate: "No máximo um aviso por fonte a cada hora &mdash; todos os pagamentos estão na sua página de rendimentos.",
    },
    {
      language: "es",
      subject: 'Keryx citó "Agent Economy Weekly" — $0.015 USDC liquidados para ti',
      body: 'Tu fuente "Agent Economy Weekly" acaba de ser citada por el agente Keryx y recibió $0.015 USDC (peso de contribución del 60%), liquidados en la red arcTestnet.',
      title: "Keryx &middot; recompensa por cita liquidada",
      heading: "Agent Economy Weekly fue citada &mdash; $0.015 USDC son tuyos",
      htmlBody: "El agente Keryx utilizó tu trabajo (peso de contribución del 60%) y liquidó $0.015 USDC a tu cartera en la red arcTestnet.",
      rate: "Recibes como máximo un aviso por fuente cada hora — todos los pagos, incluidos los realizados entre los correos, están en tu página de ingresos.",
      htmlRate: "Como máximo un aviso por fuente cada hora &mdash; todos los pagos están en tu página de ingresos.",
    },
  ] as const;

  it.each(cases)("renders neutral $language wrappers with canonical English financial prose and original article text", expected => {
    const article = { itemId: "item-1", itemTitle: 'Bản gốc <研究> "citação" & {amount}', itemUrl: "https://source.invalid/original", contentVersion: "v1" };
    const input = payload({ article });
    const before = JSON.stringify(input);
    const result = buildCitationEmailContent(input, { ...opts, language: expected.language });
    const financial = cases[0];
    expect(result.subject).toBe(financial.subject);
    expect(result.text.split("\n")[0]).toBe(financial.body);
    expect(result.text).toContain(expected.rate);
    for (const wrapper of [financial.title, financial.heading, financial.htmlBody, expected.htmlRate])
      expect(result.html).toContain(wrapper);
    expect(result.text).toContain(article.itemTitle);
    expect(result.html).toContain('Bản gốc &lt;研究&gt; &quot;citação&quot; &amp; {amount}');
    expect(result.text).not.toContain(input.query.question);
    expect(result.html).not.toContain(input.query.question);
    expect(result.text).not.toContain("item-1");
    expect(result.html).not.toContain(article.itemUrl);
    expect(JSON.stringify(input)).toBe(before);
    if (expected.language !== "en") {
      expect(result.subject).toContain("USDC settled to you");
      expect(result.text).toContain("Your source");
      expect(result.html).toContain("The Keryx agent relied on");
      expect(result.subject).not.toBe(citationEmailUnreviewedDraftMessages[expected.language].subject);
      expect(result.html).not.toContain("At most one alert");
    }
  });

  it("preserves complete default English subject/bodies except safe HTML attribute encoding", () => {
    const result = buildCitationEmailContent(payload(), opts);
    expect(result.subject).toBe(cases[0].subject);
    expect(result.text).toBe([
      cases[0].body, "", "Full dispatch trace: https://keryx.cc/dispatch/q-1",
      "Your earnings page:  https://keryx.cc/creator/src-1", "", cases[0].rate,
      "Stop these alerts: https://keryx.cc/api/notify/unsubscribe?sid=src-1&t=tok123",
    ].join("\n"));
    expect(result.html).toBe(`
<div style="max-width:560px;margin:0 auto;padding:28px 24px;background:#faf6ec;color:#211d16;font-family:Georgia,'Times New Roman',serif;border:1px solid #d8cfb8;">
  <p style="margin:0 0 4px;font-family:monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#8c2f24;">Keryx &middot; citation settled</p>
  <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">Agent Economy Weekly was cited &mdash; $0.015 USDC is yours</h1>
${"  "}
  <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">The Keryx agent relied on your work (60% contribution weight) and settled $0.015 USDC to your wallet on arcTestnet.</p>
  <p style="margin:0 0 20px;font-size:14px;line-height:1.6;">
    <a href="https://keryx.cc/dispatch/q-1" style="color:#8c2f24;">See the full dispatch trace</a> &middot;
    <a href="https://keryx.cc/creator/src-1" style="color:#8c2f24;">your earnings page</a>
  </p>
  <p style="margin:0;padding-top:14px;border-top:1px solid #d8cfb8;font-size:12px;color:#6b6151;line-height:1.6;">
    At most one alert per source per hour &mdash; every payout is on your earnings page.
    <a href="https://keryx.cc/api/notify/unsubscribe?sid=src-1&amp;t=tok123" style="color:#6b6151;">Unsubscribe</a>
  </p>
</div>`.trim());
    expect(result).toEqual(buildCitationEmailContent(payload(), { ...opts, language: "en" }));
  });

  it.each([undefined, null, "fr", "VI", "vi-VN", "es-MX", "pt-br", "", "toString", "__proto__", { language: "vi" }])(
    "uses deterministic English for missing/unsupported language %j without inferring question/source language", language => {
      const input = payload({ source: { id: "src-1", name: "Nguồn tiếng Việt" }, query: { id: "q-1", question: "Trả lời bằng tiếng Việt." } });
      expect(buildCitationEmailContent(input, { ...opts, language: language as PresentationLanguage }))
        .toEqual(buildCitationEmailContent(input, { ...opts, language: "en" }));
    },
  );

  it("uses the existing exact pt-BR alias without broad locale inference", () => {
    expect(buildCitationEmailContent(payload(), { ...opts, language: "pt-BR" as PresentationLanguage }))
      .toEqual(buildCitationEmailContent(payload(), { ...opts, language: "pt" }));
  });

  it.each(["en", "vi", "pt", "es"] as const)("escapes all %s HTML values once without expanding source placeholders", language => {
    const result = buildCitationEmailContent(payload({
      source: { id: 'src"<&', name: '原文 "<img src=x>" & {amount} $&' },
      query: { id: 'q"<&', question: "PRIVATE RESEARCH QUESTION" },
      network: 'arc"<network>&',
      article: { itemId: "item-1", itemTitle: 'Quote "<script>" & {network}', itemUrl: "https://source.invalid", contentVersion: "v1" },
    }), { base: 'https://host.invalid/base"<&', unsubToken: 'tok"<&', language });
    expect(result.html).toContain('原文 &quot;&lt;img src=x&gt;&quot; &amp; {amount} $&amp;');
    expect(result.html).toContain('Quote &quot;&lt;script&gt;&quot; &amp; {network}');
    expect(result.html).toContain('arc&quot;&lt;network&gt;&amp;');
    expect(result.html).toContain('href="https://host.invalid/base&quot;&lt;&amp;/dispatch/q&quot;&lt;&amp;"');
    expect(result.html).toContain('href="https://host.invalid/base&quot;&lt;&amp;/creator/src&quot;&lt;&amp;"');
    expect(result.html).toContain('href="https://host.invalid/base&quot;&lt;&amp;/api/notify/unsubscribe?sid=src&quot;&lt;&amp;&amp;t=tok&quot;&lt;&amp;"');
    expect(result.text).toContain('https://host.invalid/base"<&/api/notify/unsubscribe?sid=src"<&&t=tok"<&');
    expect(result.subject).toContain('原文 "<img src=x>" & {amount} $&');
    expect(result.html).not.toMatch(/<img|<script>|<network>|&amp;lt;/);
    expect(result.text).not.toContain("PRIVATE RESEARCH QUESTION");
  });

  it.each(["en", "vi", "pt", "es"] as const)("keeps six-decimal USDC precision and weight formatting in %s", language => {
    for (const amountUsdc of [0.000001, 1.234567]) {
      const result = buildCitationEmailContent(payload({ amountUsdc, weight: 0.1234 }), { ...opts, language });
      for (const body of [result.subject, result.text, result.html]) expect(body).toContain(`$${amountUsdc} USDC`);
      for (const body of [result.text, result.html]) expect(body).toContain("12%");
      expect(result.text).toContain("arcTestnet");
    }
  });
});

describe("dispatchCitationEmail stored-recipient controls (synthetic provider only)", () => {
  const source: Source = { id: "src-1", name: "Agent Economy Weekly", url: "https://source.invalid", description: "Synthetic fixture", walletAddress: "0xfixture", fetchPrice: 0, tags: [], authors: [], createdAt: "2026-07-23T00:00:00.000Z" };
  const payment: PaymentRecord = { kind: "citation", queryId: "q-1", sourceId: source.id, sourceName: source.name, payer: "fixture-payer", payee: "fixture-payee", amountUsdc: 0.015, txHash: "fixture-settlement", network: "arcTestnet", settled: true, createdAt: source.createdAt };
  const input = { source, citation: { marker: "S1", sourceId: source.id, sourceName: source.name, weight: 0.6, reward: 0.015, rationale: "Synthetic fixture" }, payments: [payment], queryId: "q-1", question: "Trả lời bằng tiếng Việt. Câu hỏi riêng tư.", network: "arcTestnet" };
  const recipient = { sourceId: source.id, email: "recipient@example.invalid", unsubToken: "a".repeat(64) };

  function fixture() {
    const state = new Map<string, string>();
    const key = recipientLanguageKey(recipient)!;
    const db = {
      getSourceNotifyEmail: vi.fn(async () => ({ email: recipient.email, unsubToken: recipient.unsubToken, lastSentAt: null as string | null })),
      getSyncState: vi.fn(async (id: string) => state.get(id) ?? null),
      markSourceNotifyEmailSent: vi.fn(async () => {}),
    };
    return { state, key, db, store: db as unknown as KeryxDB };
  }

  const http = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 200 }));
  beforeEach(() => {
    http.mockReset();
    http.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", http);
    vi.stubEnv("KERYX_RESEND_API_KEY", "synthetic-do-not-send");
    vi.stubEnv("KERYX_EMAIL_FROM", "fixture@example.invalid");
    vi.stubEnv("BASE_URL", "https://keryx.invalid");
    vi.stubEnv("KERYX_EMAIL_MIN_INTERVAL_MIN", "60");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("uses the currently stored recipient language instead of the Vietnamese question, including on the next dispatch", async () => {
    const f = fixture();
    const original = JSON.stringify(input);
    for (const [stored, expected] of [["es", "Cancelar suscripción"], ["pt-BR", "Cancelar inscrição"]] as const) {
      f.state.set(f.key, stored);
      expect(await dispatchCitationEmail(f.store, input)).toBe(true);
      expect(f.db.getSourceNotifyEmail).toHaveBeenLastCalledWith(source.id);
      expect(f.db.getSyncState).toHaveBeenLastCalledWith(f.key);
      const [url, init] = http.mock.calls[http.mock.calls.length - 1];
      expect(url).toBe("https://api.resend.com/emails");
      expect(init?.method).toBe("POST");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.headers).toEqual({ Authorization: "Bearer synthetic-do-not-send", "Content-Type": "application/json" });
      const sent = JSON.parse(init?.body as string);
      expect(sent.from).toBe("fixture@example.invalid");
      expect(sent.to).toEqual([recipient.email]);
      expect(sent.subject).toBe('Keryx cited "Agent Economy Weekly" — $0.015 USDC settled to you');
      expect(sent.html).toContain(expected);
      expect(sent.subject).not.toContain("Keryx đã trích dẫn");
      expect({ subject: sent.subject, text: sent.text, html: sent.html }).toEqual(buildCitationEmailContent(payload(), {
        base: "https://keryx.invalid", unsubToken: recipient.unsubToken, language: stored === "pt-BR" ? "pt" : "es",
      }));
      expect(init?.body).not.toContain(input.question);
      expect(f.db.markSourceNotifyEmailSent).toHaveBeenLastCalledWith(source.id, expect.any(String));
    }
    expect(http).toHaveBeenCalledTimes(2);
    expect(f.db.getSyncState).toHaveBeenCalledTimes(2);
    expect(f.db.markSourceNotifyEmailSent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(input)).toBe(original);
  });

  it.each([null, "fr", "__proto__"])("uses English for stored %j despite the Vietnamese question", async stored => {
    const f = fixture();
    if (stored !== null) f.state.set(f.key, stored);
    expect(await dispatchCitationEmail(f.store, input)).toBe(true);
    const sent = JSON.parse(http.mock.calls[0][1]?.body as string);
    expect(sent.subject).toBe('Keryx cited "Agent Economy Weekly" — $0.015 USDC settled to you');
    expect(sent.text).not.toContain(input.question);
  });

  it("uses English when stored preference reading fails", async () => {
    const f = fixture();
    f.db.getSyncState.mockRejectedValue(new Error("synthetic storage failure"));
    expect(await dispatchCitationEmail(f.store, input)).toBe(true);
    expect(JSON.parse(http.mock.calls[0][1]?.body as string).subject).toContain("USDC settled to you");
  });

  it.each(["simulated", "pending"] as const)("does not render/send or mark a %s-only payment", async settlementStatus => {
    const f = fixture(); f.state.set(f.key, "es");
    expect(await dispatchCitationEmail(f.store, { ...input, payments: [{ ...payment, settled: false, settlementStatus }] })).toBe(false);
    expect(f.db.getSyncState).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
    expect(f.db.markSourceNotifyEmailSent).not.toHaveBeenCalled();
  });

  it("retains configuration and rate gates before preference lookup or provider acceptance", async () => {
    const f = fixture();
    vi.stubEnv("KERYX_RESEND_API_KEY", "");
    expect(await dispatchCitationEmail(f.store, input)).toBe(false);
    expect(f.db.getSourceNotifyEmail).not.toHaveBeenCalled();
    vi.stubEnv("KERYX_RESEND_API_KEY", "synthetic-do-not-send");
    f.db.getSourceNotifyEmail.mockResolvedValue({ email: recipient.email, unsubToken: recipient.unsubToken, lastSentAt: new Date().toISOString() });
    expect(await dispatchCitationEmail(f.store, input)).toBe(false);
    expect(f.db.getSyncState).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
    expect(f.db.markSourceNotifyEmailSent).not.toHaveBeenCalled();
  });

  it.each(["rejected", "failed"] as const)("never marks the source sent after a %s synthetic provider", async outcome => {
    const f = fixture(); f.state.set(f.key, "es");
    if (outcome === "rejected") http.mockResolvedValue(new Response(null, { status: 503 }));
    else http.mockRejectedValue(new Error("synthetic provider failure"));
    expect(await dispatchCitationEmail(f.store, input)).toBe(false);
    expect(http).toHaveBeenCalledOnce();
    expect(f.db.markSourceNotifyEmailSent).not.toHaveBeenCalled();
  });
});
