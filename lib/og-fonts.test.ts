import { createElement } from "react";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ImageResponse } from "next/og";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicPreviewFonts, publicPreviewFontFamily } from "./og-fonts";

const fixture = vi.hoisted(() => ({ text: "" }));
vi.mock("@/lib/history/read-dispatch", () => ({ resolveDispatch: async () => ({
  run: { question: fixture.text, citations: [{ sourceName: "Synthetic public fixture" }], totalSpent: 0,
    totalToCreators: 0, createdAt: "2026-10-11T00:00:00Z" }, archive: null,
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

afterEach(() => vi.unstubAllGlobals());

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
  ])("renders %s without requesting fallback fonts", async (_language, text, count) => {
    const fetch = vi.fn(localRendererAsset);
    vi.stubGlobal("fetch", fetch);
    const fonts = await publicPreviewFonts(text as string);
    expect(fonts).toHaveLength(count as number);
    const response = new ImageResponse(createElement("div", {
      style: { display: "flex", width: "100%", height: "100%", padding: 40, fontSize: 32,
        fontFamily: publicPreviewFontFamily, background: "#F1E9D7", color: "#1B1712" },
    }, text), { width: 1200, height: 630, fonts });
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.byteLength).toBeGreaterThan(10_000);
    expect(remoteProtocols(fetch)).toEqual([]);
  }, 30_000);

  it.each([
    ["vi", "Tiếng Việt: Vì sao nghiên cứu cần nguồn đáng tin cậy?"],
    ["zh", "中文：人工智能为什么需要可靠的来源与引用证据？"],
  ])("renders all actual %s public preview routes with the local fonts", async (language, text) => {
    fixture.text = text;
    const fetch = vi.fn(localRendererAsset);
    vi.stubGlobal("fetch", fetch);
    for (const [name, render] of [["dispatch", dispatchPreview], ["creator", creatorPreview], ["wanted", wantedPreview]] as const) {
      const response = await render({ params: Promise.resolve({ id: "synthetic-public" }) });
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.readUInt32BE(16)).toBe(1200);
      expect(bytes.readUInt32BE(20)).toBe(630);
      if (process.env.KERYX_PREVIEW_CAPTURE_DIR) {
        await mkdir(process.env.KERYX_PREVIEW_CAPTURE_DIR, { recursive: true });
        await writeFile(join(process.env.KERYX_PREVIEW_CAPTURE_DIR, `${name}-${language}.png`), bytes);
      }
    }
    expect(remoteProtocols(fetch)).toEqual([]);
  }, 30_000);
});
