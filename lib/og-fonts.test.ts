import { createElement } from "react";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ImageResponse } from "next/og";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicPreviewFonts, publicPreviewFontFamily } from "./og-fonts";
import * as fontHelpers from "./og-fonts";
import { createHash } from "node:crypto";
import type { PresentationLanguage } from "../shared/i18n/presentation-language";
import { publicPreviewText } from "./og-text";
import * as textHelpers from "./og-text";

const fixture = vi.hoisted(() => ({ text: "", visibility: "public" as "public" | "private" | "unlisted" | null,
  recordedLanguage: undefined as PresentationLanguage | undefined, answer: undefined as string | undefined }));
vi.mock("@/lib/history/read-dispatch", () => ({ resolveDispatch: async () => fixture.visibility === null ? null : ({
  run: { question: fixture.text, answer: fixture.answer ?? fixture.text, trace: fixture.recordedLanguage ? [{ phase: "done", ts: 0,
    message: "Synthetic authored glyph fixture, not model-language quality evidence", detail: { answerLanguage: {
      format: "keryx-answer-language-v1", scope: "generated-prose", language: fixture.recordedLanguage,
      method: "deterministic-renderer", answerSha256: `0x${createHash("sha256").update(fixture.answer ?? fixture.text, "utf8").digest("hex")}`,
    } } }] : [], citations: [{ sourceName: "Synthetic public fixture" }], totalSpent: 0,
    totalToCreators: 0, createdAt: "2026-10-11T00:00:00Z" }, archive: null,
  visibility: fixture.visibility,
}) }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({
  getSource: async () => ({ name: fixture.text }), creatorLeaderboard: async () => [],
}) }));
vi.mock("@/lib/wanted-board", () => ({ WANTED_DETAIL_LIMIT: 100, loadWantedBoard: async () => ({}),
  findWantedBrief: () => ({ gap: { claim: fixture.text, coverage: 0, seen: 1 }, state: "open" }),
}));
import dispatchPreview from "@/app/dispatch/[id]/opengraph-image";
import creatorPreview from "@/app/creator/[id]/opengraph-image";
import wantedPreview from "@/app/wanted/[id]/opengraph-image";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); fixture.visibility = "public"; fixture.recordedLanguage = undefined; fixture.answer = undefined; });

async function localRendererAsset(input: string | URL | Request) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  // Next uses fetch for local/embedded WASM and fonts too. Serve the actual bytes
  // even when a route test runs alone; every remote fallback stays forbidden.
  if (String(input).startsWith("data:application/octet-stream;base64,")) {
    return new Response(Buffer.from(String(input).split(",")[1], "base64"), { headers: { "Content-Type": "application/wasm" } });
  }
  if (url.protocol !== "file:") throw new Error("Preview fixture forbids network access");
  return new Response(await readFile(fileURLToPath(url)), { headers: { "Content-Type": "application/wasm" } });
}

function remoteProtocols(fetch: ReturnType<typeof vi.fn<typeof localRendererAsset>>) {
  return fetch.mock.calls.map(([input]) => new URL(String(input)).protocol)
    .filter(protocol => protocol !== "file:" && protocol !== "data:");
}

describe("local public preview glyphs", () => {
  it.each([
    ["Vietnamese", "Tiếng Việt: Ă Â Đ Ê Ô Ơ Ư ă â đ ê ô ơ ư Ắ Ằ Ẳ Ẵ Ặ Ấ Ầ Ẩ Ẫ Ậ Ế Ề Ể Ễ Ệ Ố Ồ Ổ Ỗ Ộ Ớ Ờ Ở Ỡ Ợ Ứ Ừ Ử Ữ Ự ạ ả ấ ầ ẩ ẫ ậ ắ ằ ẳ ẵ ặ ẹ ẻ ẽ ế ề ể ễ ệ ỉ ị ọ ỏ ố ồ ổ ỗ ộ ớ ờ ở ỡ ợ ụ ủ ứ ừ ử ữ ự ỳ ỵ ỷ ỹ", 1],
    ["Chinese", "中文：研究问题、引用证据、创作者与支付记录。人工智能为什么需要可靠的来源？", 2],
    ["German", "Deutsch: Quellen prüfen, Aussagen belegen, Ausnahmen und Einschränkungen erhalten.", 1],
    ["Japanese", "日本語：研究資料の引用と出典を確認してください。カタカナとひらがな。", 3],
    ["Korean", "한국어: 연구 보고서와 인용 근거를 확인하세요.", 2],
    ["Hindi", "हिन्दी: शोध रिपोर्ट, उद्धरण, प्रमाण, प्रश्न और उत्तर। क्ष त्र ज्ञ श्र", 2],
    ["Indonesian", "Bahasa Indonesia: Periksa sumber, kutipan, dan bukti.", 1],
    ["Russian", "Русский: проверьте источники, цитаты, ограничения и данные. Ёж, её, й, щ, ы, ю, я.", 1],
  ])("renders %s without requesting fallback fonts", async (_language, text, count) => {
    const fetch = vi.fn(localRendererAsset);
    vi.stubGlobal("fetch", fetch);
    const fonts = await publicPreviewFonts(text as string);
    expect(fonts).toHaveLength(count as number);
    const textNode = await publicPreviewText(text as string, { fontSize: 32, maxWidth: 1120, maxHeight: 550, color: "#1B1712" });
    const response = new ImageResponse(createElement("div", {
      style: { display: "flex", width: "100%", height: "100%", padding: 40, fontSize: 32,
        fontFamily: publicPreviewFontFamily, background: "#F1E9D7", color: "#1B1712" },
    }, textNode), { width: 1200, height: 630, fonts });
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.byteLength).toBeGreaterThan(10_000);
    if (process.env.KERYX_PREVIEW_CAPTURE_DIR) {
      await mkdir(process.env.KERYX_PREVIEW_CAPTURE_DIR, { recursive: true });
      await writeFile(join(process.env.KERYX_PREVIEW_CAPTURE_DIR, `glyph-${String(_language).toLowerCase()}.png`), bytes);
    }
    expect(remoteProtocols(fetch)).toEqual([]);
  }, 30_000);

  it.each([
    ["vi", "Tiếng Việt: Vì sao nghiên cứu cần nguồn đáng tin cậy?"],
    ["zh-Hans", "中文：人工智能为什么需要可靠的来源与引用证据？"],
    ["de", "Welche Quellen belegen diese Aussage und ihre Einschränkungen?"],
    ["ja", "この研究の主張と制限を裏付ける出典は何ですか？"],
    ["ko", "이 연구의 주장과 한계를 뒷받침하는 출처는 무엇인가요?"],
    ["hi", "इस शोध के दावों और सीमाओं का समर्थन किन स्रोतों से होता है?"],
    ["id", "Sumber apa yang mendukung klaim dan keterbatasan riset ini?"],
    ["ru", "Какие источники подтверждают утверждения и ограничения исследования?"],
  ] as const)("renders all actual %s public preview routes with the local fonts", async (language, text) => {
    fixture.recordedLanguage = language;
    fixture.text = text;
    const fonts = vi.spyOn(fontHelpers, "publicPreviewFonts");
    const fetch = vi.fn(localRendererAsset);
    vi.stubGlobal("fetch", fetch);
    for (const [name, render] of [["dispatch", dispatchPreview], ["creator", creatorPreview], ["wanted", wantedPreview]] as const) {
      const response = await render({ params: Promise.resolve({ id: "synthetic-public" }) });
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.readUInt32BE(16)).toBe(1200);
      expect(bytes.readUInt32BE(20)).toBe(630);
      expect(fonts.mock.calls.at(-1)?.[0]).toContain(text);
      if (process.env.KERYX_PREVIEW_CAPTURE_DIR) {
        await mkdir(process.env.KERYX_PREVIEW_CAPTURE_DIR, { recursive: true });
        await writeFile(join(process.env.KERYX_PREVIEW_CAPTURE_DIR, `${name}-${language}.png`), bytes);
      }
    }
    expect(remoteProtocols(fetch)).toEqual([]);
  }, 30_000);

  it.each([
    ["zh-Hans", "仅用于检查字形的合成文本。", "个引用来源", "Keryx Sans SC"],
    ["ja", "字形を確認するための合成テキストです。", "件の引用出典", "Keryx Sans JP"],
    ["ko", "글자 모양 확인용 합성 텍스트입니다.", "개 출처 인용", "Keryx Sans KR"],
  ] as const)("loads local %s caption fonts when the original question is English", async (language, answer, caption, face) => {
    fixture.text = "An English original question stays literal.";
    fixture.answer = answer;
    fixture.recordedLanguage = language;
    const fonts = vi.spyOn(fontHelpers, "publicPreviewFonts");
    const fetch = vi.fn(localRendererAsset); vi.stubGlobal("fetch", fetch);
    const response = await dispatchPreview({ params: Promise.resolve({ id: "synthetic-public-original-en" }) });
    expect(fonts.mock.calls.at(-1)?.[0]).toContain(fixture.text);
    expect(fonts.mock.calls.at(-1)?.[0]).toContain(caption);
    expect(await fonts.mock.results.at(-1)!.value).toContainEqual(expect.objectContaining({ name: face }));
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.readUInt32BE(16)).toBe(1200); expect(bytes.readUInt32BE(20)).toBe(630);
    expect(remoteProtocols(fetch)).toEqual([]);
    if (process.env.KERYX_PREVIEW_CAPTURE_DIR)
      await writeFile(join(process.env.KERYX_PREVIEW_CAPTURE_DIR, `dispatch-${language}-original-en.png`), bytes);
  }, 30_000);

  it("shapes recorded Hindi captions even when the original question contains no Devanagari", async () => {
    fixture.text = "An English original question stays literal.";
    fixture.answer = "यह केवल अक्षर रचना की जाँच का कृत्रिम पाठ है।";
    fixture.recordedLanguage = "hi";
    const fonts = vi.spyOn(fontHelpers, "publicPreviewFonts"), textRender = vi.spyOn(textHelpers, "publicPreviewText");
    const fetch = vi.fn(localRendererAsset); vi.stubGlobal("fetch", fetch);
    const response = await dispatchPreview({ params: Promise.resolve({ id: "synthetic-public-original-en" }) });
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.readUInt32BE(16)).toBe(1200); expect(bytes.readUInt32BE(20)).toBe(630);
    expect(fonts.mock.calls.at(-1)?.[0]).toContain(fixture.text);
    expect(fonts.mock.calls.at(-1)?.[0]).toContain("उद्धृत स्रोत");
    expect(textRender.mock.calls.some(([text]) => text === "उद्धृत स्रोत")).toBe(true);
    expect(remoteProtocols(fetch)).toEqual([]);
    if (process.env.KERYX_PREVIEW_CAPTURE_DIR)
      await writeFile(join(process.env.KERYX_PREVIEW_CAPTURE_DIR, "dispatch-hi-original-en.png"), bytes);
  }, 30_000);

  it("renders identical generic dispatch previews for unknown, private and unlisted input without reading their question", async () => {
    fixture.text = "PRIVATE SECRET 中文 Tiếng Việt";
    const fonts = vi.spyOn(fontHelpers, "publicPreviewFonts");
    const textRender = vi.spyOn(textHelpers, "publicPreviewText");
    const fetch = vi.fn(localRendererAsset); vi.stubGlobal("fetch", fetch);
    let previous: Buffer | undefined;
    for (const visibility of [null, "private", "unlisted"] as const) {
      fixture.visibility = visibility;
      const response = await dispatchPreview({ params: Promise.resolve({ id: "same-unpublished-id" }) });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (previous) expect(bytes.equals(previous)).toBe(true);
      previous = bytes;
      expect(fonts.mock.calls.at(-1)?.[0]).not.toContain("PRIVATE SECRET");
      expect(textRender.mock.calls.some(([value]) => value.includes("PRIVATE SECRET"))).toBe(false);
    }
    expect(remoteProtocols(fetch)).toEqual([]);
  }, 30_000);
});
