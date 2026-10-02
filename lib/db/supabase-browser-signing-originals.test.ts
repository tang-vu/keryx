import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { browserQueryPolicyTypedData, verifyBrowserQueryPolicy, type BrowserQueryPolicy } from "../payments/browser-query-policy";
import { browserSigningTypedData, prepareBrowserSigningOriginal, prepareBrowserSourceSigningOriginal, serializeBrowserSigningHeader } from "../payments/browser-signing-original";
import { browserSourceContextPath, browserSourceRegistryId, type BrowserOriginalSourceContext } from "../payments/browser-original-source-context";
import type { BrowserOriginalSourceAuthority, VerifiedBrowserOriginalSourceContext } from "../payments/browser-original-source-authority";
import { prepareBrowserJournal } from "./browser-authorization-journal";
import type { BrowserOriginalAdmission, BrowserSigningSnapshot, BrowserSourceOriginalAdmission } from "./browser-signing-originals";
import { admitSupabaseBrowserQueryPolicy, admitSupabaseBrowserSigningOriginal, admitSupabaseBrowserSourceSigningOriginal, readSupabaseBrowserSigningSnapshot, readExposedSupabaseBrowserSigningSnapshotForSigner, signSupabaseBrowserSigningOriginal } from "./supabase-browser-signing-originals";

async function fixture() {
  const owner = privateKeyToAccount(generatePrivateKey()), signer = privateKeyToAccount(generatePrivateKey());
  const policy: BrowserQueryPolicy = { protocol: "durable-v2", service: "https://keryx.cc", owner: owner.address.toLowerCase() as `0x${string}`, signer: signer.address.toLowerCase() as `0x${string}`,
    policyId: `0x${"1".repeat(64)}`, grantEpoch: randomUUID(), requestNonce: `0x${"2".repeat(64)}`, queryId: randomUUID(), questionDigest: `0x${"3".repeat(64)}`,
    queryCeilingMicros: "10", lifetimeCeilingMicros: "20", jobLimit: 2, expiresAt: Date.now() + 60000 };
  const signature = await owner.signTypedData(browserQueryPolicyTypedData(policy)), proof = { policy, signature }, verified = await verifyBrowserQueryPolicy(proof);
  const payee = `0x${"4".repeat(40)}`, gateway = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
  const input: BrowserOriginalAdmission = { queryNamespace: verified.namespace, queryId: policy.queryId, journal: {
    sessionId: "synthetic-owner", requestId: "synthetic-request", queryId: policy.queryId, grantEpoch: policy.grantEpoch, signer: policy.signer,
    network: "eip155:5042002", token: "0x3600000000000000000000000000000000000000", gatewayContract: gateway,
    sourceId: "synthetic-source", offerId: null, kind: "fetch", payee, amountMicroUsdc: 1,
    requirements: { scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", payTo: payee,
      amount: "1", maxTimeoutSeconds: 604900, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: gateway } },
    payment: { kind: "fetch", queryId: policy.queryId, sourceId: "synthetic-source", sourceName: "Synthetic", payer: policy.signer, payee, amountUsdc: 0.000001, network: "eip155:5042002", grantEpoch: policy.grantEpoch, origin: "web" } } };
  const journal = prepareBrowserJournal(input.journal), original = prepareBrowserSigningOriginal(journal, verified.namespace);
  const snapshot: BrowserSigningSnapshot = { journal, original, policy: proof, currentGrant: null, active: true,
    namespace: { namespace: verified.namespace, owner: policy.owner, signer: policy.signer, service: policy.service, network: "eip155:5042002", ceilingMicros: "20", jobLimit: 2, allocatedMicros: "10", jobs: 1, ceilingProof: proof },
    query: { queryId: policy.queryId, namespace: verified.namespace, ceilingMicros: "10", spentMicros: "1", proofDigest: verified.proofDigest }, signerSpentMicros: "1", retainedEpochSpentMicros: "1" };
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null }), sb = { rpc } as unknown as SupabaseClient;
  return { owner, signer, proof, input, original, snapshot, rpc, sb };
}
describe("privileged Supabase browser originals composition", () => {
  async function sourceFixture() {
    const f = await fixture();
    const source = { sourceId: "synthetic-source", itemId: "synthetic-item", contentVersion: "v1:immutable", offerId: null };
    f.input.journal.payment.itemId = source.itemId; f.input.journal.payment.contentVersion = source.contentVersion;
    f.snapshot.journal.payment.itemId = source.itemId; f.snapshot.journal.payment.contentVersion = source.contentVersion;
    const context: BrowserOriginalSourceContext = { version: "source-context-v1", service: "https://keryx.cc", kind: "fetch",
      source: { sourceId: source.sourceId, canonicalUrl: "https://synthetic.invalid/source", registryId: browserSourceRegistryId(f.proof.policy.owner, "https://synthetic.invalid/source") },
      item: { itemId: source.itemId, contentVersion: source.contentVersion }, endpoint: { method: "GET", path: "/" },
      registry: { network: "eip155:5042002", contract: `0x${"5".repeat(40)}`, blockNumber: "1", blockHash: `0x${"8".repeat(64)}`, blockTimestamp: "1",
        creator: f.proof.policy.owner, payoutWallet: f.input.journal.payee, listPriceMicros: "1", active: true }, price: { mode: "list", amountMicros: "1" } };
    context.endpoint.path = browserSourceContextPath(context);
    f.snapshot.original = prepareBrowserSourceSigningOriginal(f.snapshot.journal, f.input.queryNamespace, context);
    const input: BrowserSourceOriginalAdmission = { ...f.input, protocol: "durable-v3", source };
    const resolve = vi.fn().mockRejectedValue(new Error("No current authority during historical replay"));
    return { ...f, input, resolve, authority: { resolve } as BrowserOriginalSourceAuthority };
  }
  it("replays a retained v3 context without resolving current registry authority or adopting another original", async () => {
    const f = await sourceFixture(); f.rpc.mockResolvedValue({ data: { status: "admitted", snapshot: f.snapshot }, error: null });
    const answer = await admitSupabaseBrowserSourceSigningOriginal(f.sb, f.input, f.authority);
    expect(answer.status).toBe("admitted"); if (answer.status === "admitted") expect(answer.original).toEqual(f.snapshot.original);
    expect(f.resolve).not.toHaveBeenCalled(); expect(f.rpc).toHaveBeenCalledExactlyOnceWith("browser_signing_replay_source_original", { p_input: f.input });
  });
  it("refuses an inactive missing-original lane before source authority or provider resolution", async () => {
    const f = await sourceFixture(); f.rpc.mockResolvedValue({ data: { status: "inactive" }, error: null });
    expect(await admitSupabaseBrowserSourceSigningOriginal(f.sb, f.input, f.authority)).toEqual({ status: "inactive" });
    expect(f.resolve).not.toHaveBeenCalled(); expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("refuses changed source identity, economics, v2 replay or forged source token before atomic RPC", async () => {
    const f = await sourceFixture(); f.rpc.mockResolvedValue({ data: { status: "admitted", snapshot: f.snapshot }, error: null });
    for (const input of [{ ...f.input, source: { ...f.input.source, itemId: "foreign" } },
      { ...f.input, journal: { ...f.input.journal, payee: f.owner.address.toLowerCase(), requirements: { ...f.input.journal.requirements, payTo: f.owner.address.toLowerCase() } } }])
      await expect(admitSupabaseBrowserSourceSigningOriginal(f.sb, input, f.authority)).rejects.toThrow();
    f.rpc.mockResolvedValue({ data: { status: "admitted", snapshot: { ...f.snapshot, original: prepareBrowserSigningOriginal(f.snapshot.journal, f.input.queryNamespace) } }, error: null });
    await expect(admitSupabaseBrowserSourceSigningOriginal(f.sb, f.input, f.authority)).rejects.toThrow();
    f.rpc.mockResolvedValue({ data: { status: "missing" }, error: null }); f.resolve.mockResolvedValue({} as VerifiedBrowserOriginalSourceContext);
    await expect(admitSupabaseBrowserSourceSigningOriginal(f.sb, f.input, f.authority)).rejects.toThrow();
    expect(f.rpc.mock.calls.every(call => call[0] === "browser_signing_replay_source_original")).toBe(true);
  });
  it("captures immutable v3 caller input and rejects citation before source resolution or backend mutation", async () => {
    const f = await sourceFixture(); f.rpc.mockResolvedValue({ data: { status: "missing" }, error: null });
    f.resolve.mockImplementation(async input => { expect(Object.isFrozen(input.source)).toBe(true); input.journal.payee = "mutated"; });
    await expect(admitSupabaseBrowserSourceSigningOriginal(f.sb, f.input, f.authority)).rejects.toThrow();
    const before = f.rpc.mock.calls.length;
    await expect(admitSupabaseBrowserSourceSigningOriginal(f.sb, { ...f.input, journal: { ...f.input.journal, kind: "citation" } }, f.authority)).rejects.toThrow();
    expect(f.rpc).toHaveBeenCalledTimes(before);
  });
  it.each(["exposed", "signed", "submission_attempted", "settled", "failed"] as const)("observes retained %s originals by independently matched signer without adopting a current grant", async phase => {
    const f = await fixture(); f.snapshot.journal.phase = phase; f.snapshot.journal.payment.authorizationPhase = phase;
    f.rpc.mockResolvedValue({ data: f.snapshot, error: null });
    const observed = await readExposedSupabaseBrowserSigningSnapshotForSigner(f.sb, f.signer.address, "synthetic-owner", "synthetic-request");
    expect(observed?.original).toEqual(f.original); expect(observed?.currentGrant).toBeNull(); expect(Object.isFrozen(observed)).toBe(true);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("browser_signing_exposed_snapshot_for_signer", { p_signer: f.signer.address.toLowerCase(), p_session_id: "synthetic-owner", p_request_id: "synthetic-request" });
  });
  it("returns no bytes for null refusal and rejects prepared/cancelled/foreign/cross-request responses", async () => {
    const f = await fixture(); expect(await readExposedSupabaseBrowserSigningSnapshotForSigner(f.sb, f.signer.address, "synthetic-owner", "synthetic-request")).toBeNull();
    for (const phase of ["prepared", "cancelled_unexposed"] as const) {
      f.snapshot.journal.phase = phase; f.rpc.mockResolvedValue({ data: f.snapshot, error: null });
      await expect(readExposedSupabaseBrowserSigningSnapshotForSigner(f.sb, f.signer.address, "synthetic-owner", "synthetic-request")).rejects.toThrow();
    }
    f.snapshot.journal.phase = "exposed";
    await expect(readExposedSupabaseBrowserSigningSnapshotForSigner(f.sb, f.owner.address, "synthetic-owner", "synthetic-request")).rejects.toThrow();
    await expect(readExposedSupabaseBrowserSigningSnapshotForSigner(f.sb, f.signer.address, "foreign-session", "synthetic-request")).rejects.toThrow();
    await expect(readExposedSupabaseBrowserSigningSnapshotForSigner(f.sb, f.signer.address, "synthetic-owner", "foreign-request")).rejects.toThrow();
  });
  it("captures exposed readback before async proof recovery and refuses corrupted owner proof", async () => {
    const f = await fixture(); f.snapshot.journal.phase = "exposed"; f.rpc.mockResolvedValue({ data: f.snapshot, error: null });
    const pending = readExposedSupabaseBrowserSigningSnapshotForSigner(f.sb, f.signer.address, "synthetic-owner", "synthetic-request");
    await Promise.resolve(); f.snapshot.journal.phase = "prepared";
    expect((await pending)?.journal.phase).toBe("exposed");
    f.snapshot.journal.phase = "exposed"; f.snapshot.policy = { ...f.proof, signature: await f.signer.signTypedData(browserQueryPolicyTypedData(f.proof.policy)) };
    await expect(readExposedSupabaseBrowserSigningSnapshotForSigner(f.sb, f.signer.address, "synthetic-owner", "synthetic-request")).rejects.toThrow();
  });
  it("verifies actual owner proof before sending policy to the restricted RPC", async () => {
    const f = await fixture(); f.rpc.mockResolvedValue({ data: { status: "admitted", namespace: f.input.queryNamespace, queryId: f.input.queryId }, error: null });
    expect((await admitSupabaseBrowserQueryPolicy(f.sb, f.proof, "synthetic-owner")).status).toBe("admitted");
    expect(f.rpc.mock.calls[0][0]).toBe("browser_signing_admit_query");
    const bad = { ...f.proof, signature: await f.signer.signTypedData(browserQueryPolicyTypedData(f.proof.policy)) };
    await expect(admitSupabaseBrowserQueryPolicy(f.sb, bad, "synthetic-owner")).rejects.toThrow(); expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("refuses mismatched policy success and transport errors", async () => {
    const f = await fixture();
    for (const result of [{ data: { status: "admitted", namespace: "foreign", queryId: f.input.queryId }, error: null }, { data: null, error: { message: "synthetic-error" } }]) {
      f.rpc.mockResolvedValue(result); await expect(admitSupabaseBrowserQueryPolicy(f.sb, f.proof, "synthetic-owner")).rejects.toThrow();
    }
  });
  it("returns the retained original rather than a newly generated admission nonce", async () => {
    const f = await fixture(); f.rpc.mockResolvedValue({ data: { status: "admitted", snapshot: f.snapshot }, error: null });
    const answer = await admitSupabaseBrowserSigningOriginal(f.sb, f.input); expect(answer.status).toBe("admitted");
    if (answer.status === "admitted") expect(answer.original).toEqual(f.original);
    expect(f.rpc.mock.calls[0][1].p_original.authorization.nonce).not.toBe(f.original.authorization.nonce);
  });
  it("captures the admission request and returned snapshot before asynchronous validation", async () => {
    const f = await fixture(); let resolve!: (value: unknown) => void;
    f.rpc.mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = admitSupabaseBrowserSigningOriginal(f.sb, f.input);
    f.input.journal.payment.sourceId = "caller-mutated";
    resolve({ data: { status: "admitted", snapshot: f.snapshot }, error: null });
    await Promise.resolve(); f.snapshot.journal.payment.sourceId = "response-mutated";
    const answer = await pending; expect(answer.status).toBe("admitted");
    if (answer.status === "admitted") expect(answer.journal.payment.sourceId).toBe("synthetic-source");
  });
  it("rejects forged, changed-epoch and changed-economic readback", async () => {
    const f = await fixture();
    for (const snapshot of [{ ...f.snapshot, original: { ...f.original, authorization: { ...f.original.authorization, value: "2" } } },
      { ...f.snapshot, journal: { ...f.snapshot.journal, grantEpoch: randomUUID() } },
      { ...f.snapshot, journal: { ...f.snapshot.journal, payment: { ...f.snapshot.journal.payment, sourceId: "foreign" } } }]) {
      f.rpc.mockResolvedValue({ data: { status: "admitted", snapshot }, error: null }); await expect(admitSupabaseBrowserSigningOriginal(f.sb, f.input)).rejects.toThrow();
    }
  });
  it("reads one coherent snapshot without any mutation or current-grant adoption", async () => {
    const f = await fixture(); f.rpc.mockResolvedValue({ data: f.snapshot, error: null });
    expect(await readSupabaseBrowserSigningSnapshot(f.sb, f.proof.policy.owner, "synthetic-owner", "synthetic-request")).toEqual(f.snapshot);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("browser_signing_snapshot", { p_owner: f.proof.policy.owner, p_session_id: "synthetic-owner", p_request_id: "synthetic-request" });
    await expect(readSupabaseBrowserSigningSnapshot(f.sb, f.signer.address, "synthetic-owner", "synthetic-request")).rejects.toThrow();
  });
  it("verifies canonical header and actual signature before legacy metadata transition", async () => {
    const f = await fixture(), signature = await f.signer.signTypedData(browserSigningTypedData(f.original));
    const header = serializeBrowserSigningHeader(f.original, signature);
    f.rpc.mockResolvedValueOnce({ data: f.original, error: null }).mockResolvedValueOnce({ data: true, error: null });
    expect(await signSupabaseBrowserSigningOriginal(f.sb, "synthetic-owner", "synthetic-request", header)).toBe(true);
    expect(f.rpc.mock.calls[1][0]).toBe("browser_signing_record_signature"); expect(f.rpc.mock.calls[1][1].p_metadata.validBefore).toBe(f.original.authorization.validBefore);
    f.rpc.mockResolvedValue({ data: f.original, error: null });
    await expect(signSupabaseBrowserSigningOriginal(f.sb, "synthetic-owner", "synthetic-request", Buffer.from("{}").toString("base64"))).rejects.toThrow();
    expect(f.rpc).toHaveBeenCalledTimes(3);
  });
  it("never canonicalizes a legacy row without a retained v2 original", async () => {
    const f = await fixture(); expect(await signSupabaseBrowserSigningOriginal(f.sb, "synthetic-owner", "legacy", "untrusted")).toBe(false); expect(f.rpc).toHaveBeenCalledTimes(1);
  });
});
