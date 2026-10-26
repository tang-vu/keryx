import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBrowserText } from "./browser-text-download";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function fixture(failure?: "create" | "append" | "click") {
  vi.useFakeTimers();
  const problem = new Error("Synthetic DOM failure");
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:synthetic-download"), revokeObjectURL = vi.fn();
  const anchor = { href: "", download: "", remove: vi.fn(), click: vi.fn(() => { if (failure === "click") throw problem; }) };
  const createElement = vi.fn(() => { if (failure === "create") throw problem; return anchor; });
  const appendChild = vi.fn(() => { if (failure === "append") throw problem; });
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.stubGlobal("document", { createElement, body: { appendChild } });
  return { problem, anchor, createObjectURL, revokeObjectURL, appendChild };
}

describe("browser text download resource ownership", () => {
  it.each(["create", "append", "click"] as const)("releases resources when %s fails and preserves the original error", failure => {
    const f = fixture(failure);
    expect(() => downloadBrowserText("Retained 🧪 text\r\n", "report.md", "text/markdown;charset=utf-8")).toThrow(f.problem);
    vi.runAllTimers();
    expect(f.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:synthetic-download");
    if (failure !== "create") expect(f.anchor.remove).toHaveBeenCalledOnce();
    expect(f.anchor.click).toHaveBeenCalledTimes(failure === "click" ? 1 : 0);
  });

  it("preserves exact native download bytes, metadata and the delayed URL lifetime", async () => {
    const f = fixture(), body = "=literal\r\nNguyễn 🧪\n";
    downloadBrowserText(body, "keryx-report.md", "text/markdown;charset=utf-8");
    const blob = f.createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe(body); expect(blob.type).toBe("text/markdown;charset=utf-8");
    expect(f.anchor.href).toBe("blob:synthetic-download"); expect(f.anchor.download).toBe("keryx-report.md");
    expect(f.appendChild).toHaveBeenCalledExactlyOnceWith(f.anchor); expect(f.anchor.click).toHaveBeenCalledOnce();
    expect(f.anchor.remove).toHaveBeenCalledOnce(); expect(f.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999); expect(f.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(f.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:synthetic-download");
  });

  it("does not allocate an anchor or schedule cleanup if object URL creation fails", () => {
    const f = fixture(); f.createObjectURL.mockImplementation(() => { throw f.problem; });
    expect(() => downloadBrowserText("text", "file.txt", "text/plain")).toThrow(f.problem);
    expect(f.appendChild).not.toHaveBeenCalled(); vi.runAllTimers(); expect(f.revokeObjectURL).not.toHaveBeenCalled();
  });
});
