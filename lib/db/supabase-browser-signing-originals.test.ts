import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { browserQueryPolicyTypedData, verifyBrowserQueryPolicy, type BrowserQueryPolicy } from "../payments/browser-query-policy";
import { browserSigningTypedData, prepareBrowserSigningOriginal, serializeBrowserSigningHeader } from "../payments/browser-signing-original";
import { prepareBrowserJournal } from "./browser-authorization-journal";
import type { BrowserOriginalAdmission, BrowserSigningSnapshot } from "./browser-signing-originals";
import { admitSupabaseBrowserQueryPolicy, admitSupabaseBrowserSigningOriginal, readSupabaseBrowserSigningSnapshot, signSupabaseBrowserSigningOriginal } from "./supabase-browser-signing-originals";

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
