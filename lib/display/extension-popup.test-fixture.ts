/** Actual popup ES module with DOM APIs and one in-memory SSE response; no HTTP or research. */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { expect, vi } from "vitest";

export async function replayExtensionPopup<T>(chunks: readonly unknown[], inspect: (
  document: Document, requests: { url: string; method: string; question: string }[],
) => T): Promise<T> {
  const dom = new JSDOM(readFileSync("extension/popup.html", "utf8"),
    { url: "https://extension.example/popup", runScripts: "outside-only" });
  const api = "https://extension.example/api/v1/chat/completions";
  const question = "Synthetic popup replay";
  const requests: { url: string; method: string; question: string }[] = [];
  const bindings = {
    document: dom.window.document, location: dom.window.location,
    chrome: { tabs: { query: async () => [] } }, KERYX_API: api,
    fetch: async (url: string, init: RequestInit) => {
      expect(url).toBe(api);
      expect(init.method).toBe("POST");
      const request = JSON.parse(String(init.body));
      expect(request.messages).toEqual([{ role: "user", content: question }]);
      requests.push({ url, method: init.method!, question });
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n");
    },
  };
  const previous = Object.keys(bindings).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  try {
    for (const [name, value] of Object.entries(bindings)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    // Every invocation needs fresh module-local element bindings for this DOM.
    vi.resetModules();
    const popupModulePath = "../../extension/popup.js";
    await import(popupModulePath);
    const document = dom.window.document as unknown as Document;
    (document.getElementById("question") as HTMLTextAreaElement).value = question;
    (document.getElementById("ask") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(requests).toHaveLength(1);
      expect(document.getElementById("status")!.textContent).toMatch(/^done/);
      expect((document.getElementById("ask") as HTMLButtonElement).disabled).toBe(false);
    });
    return inspect(document, requests);
  } finally {
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}
