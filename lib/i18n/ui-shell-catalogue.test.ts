import { expect, it, vi } from "vitest";
import { createMessages, englishMessages } from "./messages";
import { preparedLocales, shippedUiLocales } from "./locales";
import { boundedShellReporter, createShellMessages, loadUiShellCatalogue, validateShellDraft } from "./ui-shell-catalogue";

it("loads only the selected admitted target and no target for English/disabled locales", async () => {
  const viLoader = vi.fn(async () => ({ "shellNavigation.ask": { source: englishMessages["shellNavigation.ask"], text: "Đặt câu hỏi" } }));
  const zhLoader = vi.fn(async () => ({})); const loaders = { vi: viLoader, "zh-Hans": zhLoader };
  await loadUiShellCatalogue("en", preparedLocales, () => {}, loaders);
  await loadUiShellCatalogue("vi", shippedUiLocales, () => {}, loaders);
  expect(viLoader).not.toHaveBeenCalled(); expect(zhLoader).not.toHaveBeenCalled();
  const selected = await loadUiShellCatalogue("vi", preparedLocales, () => {}, loaders);
  expect(createShellMessages("vi", selected)("shellNavigation.ask")).toBe("Đặt câu hỏi");
  expect(viLoader).toHaveBeenCalledTimes(1); expect(zhLoader).not.toHaveBeenCalled();
});
it("falls back for missing, stale, invalid-placeholder, accessor and oversized entries", () => {
  const reported: string[] = [], report = boundedShellReporter((locale, key) => reported.push(`${locale}:${key}`));
  const draft = {
    "shellNavigation.ask": { source: "old English source", text: "stale" },
    "shellNavigation.sources": { source: englishMessages["shellNavigation.sources"], text: "{privateQuestion}" },
    "shellHeader.openMenu": Object.defineProperty({ source: "Open menu" }, "text", { enumerable: true, get() { throw new Error("accessor ran"); } }),
    "shellHeader.closeMenu": { source: "Close menu", text: "x".repeat(2001) },
  };
  const message = createShellMessages("vi", validateShellDraft("vi", draft, report), report);
  for (const key of ["shellNavigation.ask", "shellNavigation.sources", "shellHeader.openMenu", "shellHeader.closeMenu", "shellFooter.house"] as const) expect(message(key)).toBe(englishMessages[key]);
  expect(reported.every(value => !value.includes("privateQuestion"))).toBe(true);
  expect(reported).toContain("vi:shellFooter.house");
});
it("keeps reports bounded/deduplicated and typed source keys/parameters intact", () => {
  const report = vi.fn(), bounded = boundedShellReporter(report, 1);
  bounded("vi", "shellNavigation.ask"); bounded("vi", "shellNavigation.ask"); bounded("vi", "shellHeader.openMenu");
  expect(report).toHaveBeenCalledTimes(1); expect(report).toHaveBeenCalledWith("vi", "shellNavigation.ask");
  const message = createMessages("en"); expect(message("shellFooter.copyright", { year: 2026 })).toContain("2026");
  if (false) {
    // @ts-expect-error Unknown English keys must fail checking.
    message("shellNavigation.typo");
    // @ts-expect-error Required named parameters must fail checking.
    message("shellFooter.copyright");
  }
});
