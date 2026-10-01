import { expect, it, vi } from "vitest";
it("shares admission across module copies and makes releases idempotent", async () => {
  const first = await import("./parser-slots");
  vi.resetModules();
  const second = await import("./parser-slots");
  const releaseFirst = first.acquireParserSlot();
  expect(() => second.acquireParserSlot()).toThrow("busy");
  releaseFirst();
  const releaseSecond = second.acquireParserSlot();
  releaseFirst();
  expect(() => first.acquireParserSlot()).toThrow("busy");
  releaseSecond();
  const recovered = first.acquireParserSlot(); recovered();
});
