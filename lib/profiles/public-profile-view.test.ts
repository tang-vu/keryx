import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicResearcherProfile } from "../../components/keryx/public-researcher-profile";
import type { PublicProfileSnapshot } from "./public-profile";
import * as fontHelpers from "../og-fonts";
import * as textHelpers from "../og-text";
import { publicProfileCopy as copy } from "@/locales/en/public-profiles";

type ImageOptions = NonNullable<ConstructorParameters<typeof import("next/og").ImageResponse>[1]>;
const fixture = vi.hoisted(() => ({
  snapshot: null as PublicProfileSnapshot | null,
  read: vi.fn<(handle: string) => Promise<PublicProfileSnapshot | null>>(),
  image: vi.fn<(element: ReactElement, options: ImageOptions) => void>(),
  renderPng: false,
}));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ runPrivacyActive: true, publicProfiles: { read: fixture.read } }) }));
vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("404"); } }));
vi.mock("next/og", async importOriginal => {
  const actual = await importOriginal<typeof import("next/og")>();
  return { ...actual, ImageResponse: class extends Response {
    constructor(element: ReactElement, options: ImageOptions) {
      super(null, { headers: options.headers });
      fixture.image(element, options);
      if (fixture.renderPng) return new actual.ImageResponse(element, options);
    }
  } };
});
import ProfilePage, { generateMetadata } from "@/app/u/[handle]/page";
import profileImage, { contentType, dynamic, revalidate, size } from "@/app/u/[handle]/opengraph-image";

const profile: PublicProfileSnapshot = { version: 1, handle: "alice", displayName: "<script>owner text</script>",
  publishedAt: "2026-10-12T00:00:00.000Z", ownershipBasis: "signed-wallet-publication-existing-run-proof",
  ledgers: [{ network: "eip155:5042", readerPaidMicros: "1000000001", creatorEarnedMicros: "1", sponsoredCreatorPaymentsMicros: "0" },
    { network: "eip155:5042002", readerPaidMicros: null, creatorEarnedMicros: "0", sponsoredCreatorPaymentsMicros: "2000000" }],
  ledgerBasis: "wallet-wide-recorded-settled-creator-events", runs: [{ id: "run", question: "Which report?", createdAt: "2026-10-12T00:00:00.000Z", surface: "stdio-mcp",
    network: "eip155:5042002", funding: "sponsored", ownership: "claimed", citations: [{ marker: "S1", sourceName: "Source" }], reportPath: "/dispatch/run", receiptsPath: "/api/dispatch/run/receipt" }] };

const params = () => ({ params: Promise.resolve({ handle: "alice" }) });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BASE_URL", "https://synthetic-profile.example");
  vi.stubEnv("KERYX_PUBLIC_PROFILES_ENABLED", "true");
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  fixture.snapshot = { ...profile, displayName: "Tên chủ hồ sơ", about: "原文简介", purpose: "Mục đích nghiên cứu" };
  fixture.read.mockImplementation(async () => fixture.snapshot);
  fixture.renderPng = false;
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("Profile fixture forbids network access"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("#264 public view semantics (SSR, not compiled phone evidence)", () => {
  it("escapes owner text, uses accessible named regions, keeps exact amounts and truthful ownership/funding labels", () => {
    const dom = new JSDOM(renderToStaticMarkup(createElement(PublicResearcherProfile, { profile }))), document = dom.window.document;
    try {
      expect(document.querySelectorAll("main")).toHaveLength(1); expect(document.querySelectorAll("h1")).toHaveLength(1); expect(document.querySelectorAll("script")).toHaveLength(0);
      for (const section of document.querySelectorAll("section")) expect(document.getElementById(section.getAttribute("aria-labelledby")!)?.textContent).toBeTruthy();
      const text = document.body.textContent!; expect(text).toContain("1000.000001 USDC"); expect(text).toContain("0.000001 USDC"); expect(text).toContain("Unavailable");
      expect(text).toContain("Arc mainnet"); expect(text).toContain("Arc testnet"); expect(text).toContain("Treasury sponsored"); expect(text).toContain("Claimed through the original receipt");
      expect(document.querySelector('a[href="/api/u/alice"]')).not.toBeNull(); expect(document.querySelector('a[href="/api/dispatch/run/receipt"]')).not.toBeNull();
      expect(document.querySelector("time")?.getAttribute("datetime")).toBe(profile.runs[0].createdAt);
    } finally { dom.window.close(); }
  });
});

describe("actual public profile metadata and preview consumers", () => {
  it("keeps original owner metadata and the JSON link on one canonical with shipped English alternates", async () => {
    const before = JSON.stringify(fixture.snapshot);
    const metadata = await generateMetadata(params());
    expect(metadata.alternates).toEqual({ canonical: "/u/alice", languages: { en: "/u/alice", "x-default": "/u/alice" },
      types: { "application/json": "/api/u/alice" } });
    expect(metadata.title).toBe(fixture.snapshot!.displayName);
    expect(metadata.description).toBe(fixture.snapshot!.purpose);
    expect(metadata.openGraph).toMatchObject({ type: "profile", url: "/u/alice", images: ["/u/alice/opengraph-image"] });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", images: ["/u/alice/opengraph-image"] });
    expect(JSON.stringify(fixture.snapshot)).toBe(before);
  });

  it("declares English only on the ProfilePage wrapper, preserving original biography and report text", async () => {
    const dom = new JSDOM(renderToStaticMarkup(await ProfilePage(params())));
    try {
      const data = JSON.parse(dom.window.document.querySelector('script[type="application/ld+json"]')!.textContent!);
      expect(data).toMatchObject({ "@type": "ProfilePage", inLanguage: "en", url: "https://synthetic-profile.example/u/alice" });
      expect(data.mainEntity).toEqual({ "@type": "Person", name: fixture.snapshot!.displayName, description: fixture.snapshot!.about });
      expect(JSON.stringify(data).match(/"inLanguage"/g)).toHaveLength(1);
      expect(dom.window.document.body.textContent).toContain(profile.runs[0].question);
      expect(dom.window.document.querySelectorAll('[lang="en"]')).toHaveLength(0);
    } finally { dom.window.close(); }
  });

  it.each(["unpublished", "profiles disabled", "privacy disabled", "storage refusal"])("refuses %s across head, page and image", async state => {
    const fonts = vi.spyOn(fontHelpers, "publicPreviewFonts");
    const shaping = vi.spyOn(textHelpers, "publicPreviewFittedText");
    if (state === "unpublished") fixture.snapshot = null;
    if (state === "profiles disabled") vi.stubEnv("KERYX_PUBLIC_PROFILES_ENABLED", "false");
    if (state === "privacy disabled") vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false");
    if (state === "storage refusal") fixture.read.mockRejectedValue(Error("private storage sentinel"));
    expect(await generateMetadata(params())).toEqual({ title: copy.unavailableTitle, robots: { index: false, follow: false } });
    await expect(ProfilePage(params())).rejects.toThrow("404");
    const response = await profileImage(params());
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(fonts).not.toHaveBeenCalled();
    expect(shaping).not.toHaveBeenCalled();
    expect(fixture.image).not.toHaveBeenCalled();
  });

  it.each([
    { name: "Vietnamese", displayName: "Tiếng Việt: Nguyễn Ánh", purpose: "Nghiên cứu nguồn đáng tin cậy", about: "UNDISPLAYED 中文", faces: ["Keryx Sans"] },
    { name: "Han display name", displayName: "中文研究者", purpose: "Original purpose", about: "UNDISPLAYED", faces: ["Keryx Sans", "Keryx Sans SC"] },
    { name: "Han purpose", displayName: "Original name", purpose: "研究来源与引用证据", about: "UNDISPLAYED", faces: ["Keryx Sans", "Keryx Sans SC"] },
    { name: "Han biography fallback", displayName: "Original name", purpose: "", about: "研究来源与引用证据", faces: ["Keryx Sans", "Keryx Sans SC"] },
  ])("selects bundled faces over every displayed string for $name", async ({ name: _name, faces, ...text }) => {
    fixture.snapshot = { ...profile, ...text };
    const fonts = vi.spyOn(fontHelpers, "publicPreviewFonts");
    const before = JSON.stringify(fixture.snapshot);
    const response = await profileImage(params());
    const [element, options] = fixture.image.mock.calls[0];
    expect(fonts).toHaveBeenCalledExactlyOnceWith([`${copy.brand} · @alice`, text.displayName, text.purpose || text.about, copy.imageOwnership].join("\n"));
    expect(options.fonts?.map(font => font.name)).toEqual(faces);
    expect(renderToStaticMarkup(element)).toContain(fontHelpers.publicPreviewFontFamily);
    const dom = new JSDOM(renderToStaticMarkup(element));
    try {
      expect(Array.from(dom.window.document.body.firstElementChild!.children).map(node => node.querySelector("img")?.alt ?? node.textContent))
        .toEqual([`${copy.brand} · @alice`, text.displayName, text.purpose || text.about, copy.imageOwnership]);
      const images = Array.from(dom.window.document.querySelectorAll("img"));
      expect(images).toHaveLength(2);
      images.forEach((image, index) => {
        expect(image.width).toBeLessThanOrEqual(1060);
        expect(image.height).toBeLessThanOrEqual(index === 0 ? 160 : 140);
      });
    }
    finally { dom.window.close(); }
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fixture.read).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(fixture.snapshot)).toBe(before);
    expect({ contentType, dynamic, revalidate, size }).toEqual({ contentType: "image/png", dynamic: "force-dynamic", revalidate: 0, size: { width: 1200, height: 630 } });
  });

  it.each(["unpublished", "displayed text removed", "final read refused"])("refuses the old public card when %s during held text shaping", async change => {
    let release!: (text: string) => void;
    const shaping = vi.spyOn(textHelpers, "publicPreviewFittedText").mockReturnValue(new Promise(resolve => { release = resolve; }));
    const pending = profileImage(params());
    await vi.waitFor(() => expect(shaping).toHaveBeenCalledTimes(2));
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(fixture.image).not.toHaveBeenCalled();
    if (change === "unpublished") fixture.snapshot = null;
    if (change === "displayed text removed") fixture.snapshot = { ...profile };
    if (change === "final read refused") fixture.read.mockRejectedValue(Error("erased/private storage sentinel"));
    release("prepared original text");
    const response = await pending;
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(fixture.read).toHaveBeenCalledTimes(2);
    expect(fixture.image).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("propagates shaping failure without rendering or a provider fallback", async () => {
    vi.spyOn(textHelpers, "publicPreviewFittedText").mockRejectedValue(Error("local shaping refused"));
    await expect(profileImage(params())).rejects.toThrow("local shaping refused");
    expect(fixture.image).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["unpublished", "displayed text removed", "final read refused"])("refuses the old public card when %s during held font I/O", async change => {
    let release!: (fonts: Awaited<ReturnType<typeof fontHelpers.publicPreviewFonts>>) => void;
    const fonts = vi.spyOn(fontHelpers, "publicPreviewFonts").mockReturnValue(new Promise(resolve => { release = resolve; }));
    const pending = profileImage(params());
    await vi.waitFor(() => expect(fonts).toHaveBeenCalledTimes(1));
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(fixture.image).not.toHaveBeenCalled();
    if (change === "unpublished") fixture.snapshot = null;
    if (change === "displayed text removed") fixture.snapshot = { ...profile };
    if (change === "final read refused") fixture.read.mockRejectedValue(Error("erased/private storage sentinel"));
    release([]);
    const response = await pending;
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(fixture.read).toHaveBeenCalledTimes(2);
    expect(fixture.image).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("propagates local font failure without a provider fallback or an image", async () => {
    vi.spyOn(fontHelpers, "publicPreviewFonts").mockRejectedValue(Error("bundled font unavailable"));
    await expect(profileImage(params())).rejects.toThrow("bundled font unavailable");
    expect(fixture.image).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  // Same local-only ImageResponse/WASM adapter and optional capture convention as og-fonts.test.ts.
  it.each([
    ["vi", "Nguyễn Ánh", "Vì sao nghiên cứu cần nguồn đáng tin cậy?"],
    ["han", "中文研究者", "人工智能为什么需要可靠的来源与引用证据？"],
    ["de", "Deutsche Forschung", "Quellen prüfen und Einschränkungen erhalten."],
    ["ja", "日本語の研究者", "研究資料の出典と引用を確認してください。"],
    ["ko", "한국어 연구자", "연구 보고서와 인용 근거를 확인하세요."],
    ["hi", "हिन्दी शोधकर्ता", "शोध रिपोर्ट, उद्धरण, प्रमाण, प्रश्न और उत्तर।"],
    ["id", "Peneliti Indonesia", "Periksa sumber, kutipan, dan keterbatasan bukti."],
    ["hi-long", "शोध ".repeat(20).trim(), "प्रमाण ".repeat(20).trim()],
    ["ja-long", "研究者".repeat(26), "出典と証拠を確認します。".repeat(10)],
    ["latin-long", "LongName".repeat(10), "OriginalPurpose".repeat(10)],
    ["mixed", "Café हिन्दी 日本語 한국어", "Literal <i>प्रमाण</i> & café 日本語 한국어 {question}"],
  ])("renders the actual %s profile ImageResponse with bundled fonts", async (language, displayName, purpose) => {
    fixture.snapshot = { ...profile, displayName, purpose };
    fixture.renderPng = true;
    const localFetch = vi.fn(async (input: string | URL | Request) => {
      const value = input instanceof Request ? input.url : String(input);
      if (value.startsWith("data:application/octet-stream;base64,")) {
        return new Response(Buffer.from(value.split(",")[1], "base64"), { headers: { "Content-Type": "application/wasm" } });
      }
      const url = new URL(value);
      if (url.protocol !== "file:") throw Error("Profile fixture forbids network access");
      return new Response(await readFile(fileURLToPath(url)), { headers: { "Content-Type": "application/wasm" } });
    });
    vi.stubGlobal("fetch", localFetch);
    const response = await profileImage(params());
    const element = fixture.image.mock.calls[0][0];
    const dom = new JSDOM(renderToStaticMarkup(element));
    try {
      const images = Array.from(dom.window.document.querySelectorAll("img"));
      expect(images.map(image => image.alt)).toEqual([displayName, purpose]);
      expect(images.every(image => image.width <= 1060)).toBe(true);
      expect(images[0].height).toBeLessThanOrEqual(160);
      expect(images[1].height).toBeLessThanOrEqual(140);
      expect(images.every(image => image.style.flexShrink === "0")).toBe(true);
    } finally { dom.window.close(); }
    const bytes = Buffer.from(await response.arrayBuffer());
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
    expect(bytes.byteLength).toBeGreaterThan(10_000);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(localFetch.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : String(input)).protocol)
      .filter(protocol => protocol !== "file:" && protocol !== "data:")).toEqual([]);
    if (process.env.KERYX_PREVIEW_CAPTURE_DIR) {
      await mkdir(process.env.KERYX_PREVIEW_CAPTURE_DIR, { recursive: true });
      await writeFile(join(process.env.KERYX_PREVIEW_CAPTURE_DIR, `profile-${language}.png`), bytes);
    }
  }, 30_000);
});
