import { describe, expect, it, vi } from "vitest";
import { PublicProfileError, publicHandle, publicProfileInput, publicProfilesEnabled, requirePublicProfiles, type PublicProfilesStore } from "./public-profile";
import { publicCitationUrl, publicRun, recordedMicros, type PublicRunSource } from "./public-profile-projection";
import { createPublicProfileOwnerRoutes, readPublicProfileJson } from "./public-profile-route";
import type { KeryxDB } from "../db/keryx-db";

const wallet = `0x${"a".repeat(40)}`, sessionHash = "a".repeat(64), binding = { network: "eip155:5042002" as const, origin: "https://profile-fixture.example" };
const run: PublicRunSource = { id: "public", question: "Public question", createdAt: "2026-10-12T00:00:00.000Z", citations: [{ marker: "S1", sourceName: "Source", itemUrl: "https://source.example/section#facts" }],
  provenance: { version: 1, surface: "remote-mcp", ownershipMethod: "api-key" } };
const request = (method = "GET", extra: Record<string, string> = {}, body?: string) => new Request(`${binding.origin}/api/me/public-profile`, {
  method, headers: { "x-keryx-expected-wallet": wallet, origin: binding.origin, "content-type": "application/json", ...extra }, ...(body === undefined ? {} : { body }) });
function fixture() {
  const settings = { published: true, handle: "alice", fields: ["displayName"], runIds: ["public"], revision: 1, updatedAt: run.createdAt };
  const store = { read: vi.fn(async () => null), settings: vi.fn(async () => settings), update: vi.fn(async () => settings), unpublish: vi.fn(async () => {}), sitemap: vi.fn(async () => []) };
  const db = { runPrivacyActive: true, publicProfiles: store } as unknown as KeryxDB;
  const session = vi.fn(async () => ({ db, wallet, currentId: sessionHash }));
  return { store, db, session, routes: createPublicProfileOwnerRoutes({ session, binding }) };
}
describe("#264 closed public profile and owner boundary", () => {
  it("admits canonical handles and bounded unique selections without unknown keys", () => {
    for (const handle of ["ab", "api", "bad/name", "x".repeat(33)]) expect(publicHandle.safeParse(handle).success).toBe(false);
    expect(publicHandle.parse("ALICE")).toBe("alice");
    const input = { published: true, fields: ["displayName"], runIds: ["one"], revision: 0 };
    expect(publicProfileInput.safeParse(input).success).toBe(true);
    for (const value of [{ ...input, wallet }, { ...input, fields: ["displayName", "displayName"] }, { ...input, runIds: ["one", "one"] },
      { ...input, runIds: Array.from({ length: 51 }, (_, i) => `id${i}`) }, { ...input, revision: 0.5 }]) expect(publicProfileInput.safeParse(value).success).toBe(false);
  });
  it("uses stored provenance, surfaces and network evidence; never infers a network from current configuration", () => {
    expect(publicRun(run, false, [])).toMatchObject({ surface: "remote-mcp", ownership: "api-key", network: null, funding: "unknown" });
    expect(publicRun(run, true, [binding.network])).toMatchObject({ ownership: "claimed", network: binding.network });
    expect(publicRun(run, false, [binding.network, "eip155:5042"]).network).toBeNull();
    expect(publicRun(run, false, [binding.network, "unknown"]).network).toBeNull();
    expect(publicRun({ ...run, paymentMode: "offline", fundingOwner: "treasury" }, false, []).funding).toBe("simulation");
    expect(publicRun({ ...run, fundingOwner: "treasury" }, false, []).funding).toBe("sponsored");
    expect(publicRun({ ...run, fundingOwner: "browser" }, false, []).funding).toBe("reader-funded");
    const sponsored={version:1 as const,network:binding.network,cohort:"outside" as const,payment:"sponsored" as const,actorEvidenceSha256:"a".repeat(64),fundingEvidenceSha256:"b".repeat(64)};
    expect(publicRun({...run,usage:sponsored},false,[]).funding).toBe("sponsorship-recorded");
    expect(publicRun({...run,usage:sponsored,fundingOwner:"browser"},false,[]).funding).toBe("reader-funded");
    expect(publicRun({ ...run, provenance: { version: 1, surface: "cli", ownershipMethod: "unknown", token: "PRIVATE" } } as PublicRunSource, false, []).ownership).toBe("recorded-unknown");
  });
  it("projects no private body fields or unsafe citation URL credentials", () => {
    const projected = publicRun({ ...run, answer: "PRIVATE answer", trace: ["PRIVATE"], asker: wallet } as PublicRunSource, false, []);
    expect(JSON.stringify(projected)).not.toContain("PRIVATE"); expect(JSON.stringify(projected)).not.toContain(wallet);
    expect(projected.reportPath).toBe("/dispatch/public"); expect(projected.receiptsPath).toBe("/api/dispatch/public/receipt");
    for (const url of ["http://source.example", "https://user:secret@source.example/", "https://source.example/?token=secret", "javascript:alert(1)"])
      expect(publicCitationUrl(url)).toBeUndefined();
    expect(projected.citations[0].itemUrl).toBe("https://source.example/section#facts");
  });
  it("admits exact six-decimal ledger amounts without rounding", () => {
    expect(recordedMicros(0.000001)).toBe("1"); expect(recordedMicros(1000.000001)).toBe("1000000001");
    for (const value of [0, -1, NaN, Infinity, 0.0000001, "0.1"]) expect(recordedMicros(value)).toBeNull();
  });
  it("fails closed for absent, disabled and sealed capabilities without fallback", () => {
    expect(publicProfilesEnabled({})).toBe(false); expect(publicProfilesEnabled({KERYX_PUBLIC_PROFILES_ENABLED:"true"})).toBe(false);
    expect(publicProfilesEnabled({KERYX_PUBLIC_PROFILES_ENABLED:"true",KERYX_RUN_PRIVACY_ENABLED:"true"})).toBe(true);
    for (const db of [{}, { runPrivacyActive: false, publicProfiles: {} as PublicProfilesStore }, new Proxy({}, { get() { throw new Error("sealed private domain"); } })])
      expect(() => requirePublicProfiles(db)).toThrow("public_profile_unavailable");
  });
  it("requires an explicit active signed wallet and same-origin write before reading the store", async () => {
    const f = fixture();
    expect((await f.routes.GET(request("GET", { authorization: "Bearer synthetic" }))).status).toBe(401);
    expect((await f.routes.PUT(request("PUT", { origin: "https://attacker.example" }, "{}"))).status).toBe(403);
    expect((await f.routes.GET(request("GET", { "x-keryx-expected-wallet": `0x${"b".repeat(40)}` }))).status).toBe(409);
    expect(f.store.settings).not.toHaveBeenCalled(); expect(f.store.update).not.toHaveBeenCalled();
    const response = await f.routes.GET(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(f.store.settings).toHaveBeenCalledWith({ wallet, sessionHash, binding });
  });
  it("rejects selectors, missing owner precondition, extra body keys and overlong input", async () => {
    const f = fixture();
    expect((await f.routes.GET(new Request(`${binding.origin}/api/me/public-profile`))).status).toBe(428);
    expect((await f.routes.GET(new Request(`${binding.origin}/api/me/public-profile?wallet=${wallet}`))).status).toBe(400);
    expect((await f.routes.PUT(request("PUT", {}, JSON.stringify({ published: true, fields: [], runIds: [], revision: 0, wallet })))).status).toBe(400);
    expect((await f.routes.PUT(request("PUT", {}, " ".repeat(8193)))).status).toBe(400); expect(f.store.update).not.toHaveBeenCalled();
  });
  it("binds writes to the configured public origin despite internal transport URLs and refuses forged matching URLs", async () => {
    const f=fixture(),input=JSON.stringify({published:true,fields:[],runIds:[],revision:1});
    const headers={"x-keryx-expected-wallet":wallet,"content-type":"application/json",origin:binding.origin};
    const internal=new Request("http://127.0.0.1:3939/api/me/public-profile",{method:"PUT",headers,body:input});
    expect((await f.routes.PUT(internal)).status).toBe(200);
    expect(f.store.update).toHaveBeenCalledWith({wallet,sessionHash,binding},JSON.parse(input));
    f.store.update.mockClear();f.session.mockClear();
    for(const origin of ["https://attacker.example","http://127.0.0.1:3939",""]){
      const forged=new Request(`${origin||binding.origin}/api/me/public-profile`,{method:"PUT",headers:{...headers,origin},body:input});
      const response=await f.routes.PUT(forged);expect(response.status).toBe(403);expect(await response.json()).toEqual({error:"same_origin_required"});
    }
    expect(f.session).not.toHaveBeenCalled();expect(f.store.update).not.toHaveBeenCalled();
  });
  it("handles unknown/noncanonical handles and unavailable capabilities without disclosing private errors", async () => {
    const f = fixture(); expect((await readPublicProfileJson(f.db, "alice")).status).toBe(404);
    expect((await readPublicProfileJson(f.db, "ALICE")).status).toBe(404);
    f.store.read.mockRejectedValueOnce(new Error("PRIVATE raw database key"));
    const response = await readPublicProfileJson(f.db, "alice"); expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("uses DELETE solely to revoke publication and returns the confirmed acknowledgment", async () => {
    const f = fixture(), response = await f.routes.DELETE(request("DELETE"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ unpublished: true }); expect(f.store.unpublish).toHaveBeenCalledWith({ wallet, sessionHash, binding });
    expect(f.store.update).not.toHaveBeenCalled();
  });
  it("never reports unpublish success or publishes selected private fields after a storage authority refusal",async()=>{
    const f=fixture();f.store.unpublish.mockRejectedValueOnce(new PublicProfileError("profile_required"));
    const missing=await f.routes.DELETE(request("DELETE"));expect(missing.status).toBe(409);expect(await missing.json()).toEqual({error:"profile_required"});
    f.store.update.mockRejectedValueOnce(new PublicProfileError("unauthenticated"));
    const expired=await f.routes.PUT(request("PUT",{},JSON.stringify({published:true,fields:["about","purpose"],runIds:["private-selected"],revision:0})));
    expect(expired.status).toBe(401);expect(await expired.json()).toEqual({error:"unauthenticated"});expect(f.store.read).not.toHaveBeenCalled();
  });
});
