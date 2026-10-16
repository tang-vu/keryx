import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { emptyUiPreview, getUiPreview, loadUiPreview, previewCopy, previewText } from "./ui-preview";
import { englishMessages, createMessages } from "./messages";
import { setupCopy } from "@/locales/en/get-started";

it("loads only the requested target, reuses it and keeps English empty", async () => {
  expect(await loadUiPreview("en")).toBe(emptyUiPreview);
  expect(getUiPreview("zh-Hans")).toBe(emptyUiPreview);
  const vi = await loadUiPreview("vi");
  expect(await loadUiPreview("vi")).toBe(vi);
  expect(getUiPreview("zh-Hans")).toBe(emptyUiPreview);
  expect(previewText(vi, "What do you want to know?")).not.toBe("What do you want to know?");
  const zh = await loadUiPreview("zh-Hans");
  expect(previewText(zh, "What do you want to know?")).not.toBe(previewText(vi, "What do you want to know?"));
});

it("keeps exact originals, missing and ambiguous values and namespace boundaries", () => {
  const preview = { a: { Question: "Câu hỏi", Shared: "Một" }, b: { Shared: "Hai" } };
  expect(previewText(preview, "Question", ["a"])).toBe("Câu hỏi");
  expect(previewText(preview, "Question", ["b"])).toBe("Question");
  expect(previewText(preview, "Shared")).toBe("Shared");
  expect(previewText(preview, "Question: unchanged original evidence")).toBe("Question: unchanged original evidence");
  expect(previewText(preview, "toString")).toBe("toString");
});

it("translates authored objects without changing the source, links, IDs or English critical prose", async () => {
  for (const locale of ["vi", "zh-Hans"] as const) {
    const preview = await loadUiPreview(locale);
    const copy = previewCopy(preview, "get-started", setupCopy);
    expect(copy.start.title).not.toBe(setupCopy.start.title);
    expect(copy.surfaces.map(surface => [surface.id, surface.href])).toEqual(setupCopy.surfaces.map(surface => [surface.id, surface.href]));
    expect(setupCopy.start.title).toBe("Your research. Wherever you work.");
    for (const key of ["researchEntry.sessionNotice", "account.signatureInstruction", "privateProfile.privacyBoundary"] as const) {
      expect(previewText(preview, englishMessages[key])).toBe(englishMessages[key]);
    }
    const legal = JSON.parse(readFileSync(new URL(`../../locales/${locale}/ui-drafts/legal.json`, import.meta.url), "utf8"));
    for (const value of Object.values(legal.entries) as { source: string }[]) expect(previewText(preview, value.source, ["legal"])).toBe(value.source);
  }
});

it("interpolates selected templates once without translating user-supplied values", async () => {
  const preview = await loadUiPreview("vi");
  const key = "report.citedSources.other";
  const source = englishMessages[key];
  const text = previewText(preview, source);
  expect(text).toContain("{count}");
  expect(createMessages("vi", { [key]: text })(key, { count: 7 })).toContain("7");
});
