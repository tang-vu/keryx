import { describe, expect, it } from "vitest";
import { documentAlreadyRead, documentSelectionKey } from "./document-selection";

describe("canonical document selection identity", () => {
  it("groups delivery identities at the same location without assigning ownership", () => {
    const publicCopy = { sourceId: "public:web:original", itemUrl: "https://EXAMPLE.test/article?utm_source=search#recovery" };
    const registered = { sourceId: "creator", assetId: "item:registered", itemUrl: "https://example.test/article" };
    expect(documentSelectionKey(publicCopy)).toBe(documentSelectionKey(registered));
    expect(documentAlreadyRead(registered, [publicCopy])).toBe(true);
    expect(registered.sourceId).toBe("creator");
  });

  it("keeps version paths, meaningful query values and different publishers separate", () => {
    const key = (itemUrl: string) => documentSelectionKey({ sourceId: "source", itemUrl });
    expect(key("https://example.test/article?v=1")).not.toBe(key("https://example.test/article?v=2"));
    expect(key("https://example.test/v1/article")).not.toBe(key("https://example.test/v2/article"));
    expect(key("https://a.test/article")).not.toBe(key("https://b.test/article"));
    expect(key("https://example.test/article?a=1&b=2")).toBe(key("https://example.test/article?b=2&a=1"));
  });

  it("uses independent asset identities when no supported document URL is known", () => {
    expect(documentSelectionKey({ sourceId: "a", itemUrl: "http://example.test/article" })).toBe("asset:a");
    expect(documentAlreadyRead({ sourceId: "b" }, [{ sourceId: "a" }])).toBe(false);
    expect(documentSelectionKey({ sourceId: "source", assetId: "item:v2" })).toBe("asset:item:v2");
  });
});
