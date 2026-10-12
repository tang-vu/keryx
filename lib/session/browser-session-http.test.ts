import { afterEach, expect, it, vi } from "vitest";
import { sessionJson } from "./browser-session-http";
afterEach(() => vi.unstubAllGlobals());
it("allows only the exact managed-source claim read through authenticated bounded transport", async () => {
  const fetch = vi.fn(async () => Response.json({ claim: { id: "a".repeat(64) } }));
  vi.stubGlobal("fetch", fetch);
  const path = `/api/source-claims?claimId=${"a".repeat(64)}`;
  expect(await sessionJson(path)).toEqual({ claim: { id: "a".repeat(64) } });
  expect(fetch).toHaveBeenCalledWith(path, expect.objectContaining({ method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store" }));
  for (const wrong of [path + "&next=other", path.replace("claimId", "wallet"), path.replace("a".repeat(64), "a".repeat(63))])
    await expect(sessionJson(wrong)).rejects.toThrow("Session API refused");
  await expect(sessionJson(path, "POST", {})).rejects.toThrow("Session API refused");
  await expect(sessionJson(path, "GET", {})).rejects.toThrow("Session API refused");
  expect(fetch).toHaveBeenCalledTimes(1);
});
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
