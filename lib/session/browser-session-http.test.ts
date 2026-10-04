import { afterEach, expect, it, vi } from "vitest";
import { sessionJson } from "./browser-session-http";
afterEach(() => vi.unstubAllGlobals());
it("delivers the exact original abort through authenticated same-origin transport", async () => {
  const fetch = vi.fn(async () => Response.json({ signingPhase: "aborted_before_publication" }));
  vi.stubGlobal("fetch", fetch);
  const proof = { requestId: `0x${"11".repeat(32)}`, signature: `0x${"22".repeat(65)}` };
  expect(await sessionJson("/api/session/withdraw/abort", "POST", proof)).toEqual({ signingPhase: "aborted_before_publication" });
  expect(fetch).toHaveBeenCalledWith("/api/session/withdraw/abort", expect.objectContaining({ method:"POST", credentials:"same-origin",
    redirect:"error", cache:"no-store", body:JSON.stringify(proof) }));
  for (const path of ["https://other.example/api/session/withdraw/abort", "/api/session/withdraw/abort/extra", "/api/session/withdraw/abort?next=other"])
    await expect(sessionJson(path, "POST", proof)).rejects.toThrow("Session API refused");
  expect(fetch).toHaveBeenCalledTimes(1);
});
