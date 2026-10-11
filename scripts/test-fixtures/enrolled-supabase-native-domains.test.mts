import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { STORAGE_TESTNET_PROFILE_DIGEST, type StorageIdentity } from "../../lib/db/storage-identity";
import { exerciseEnrolledSupabaseNativeDomains } from "./enrolled-supabase-native-domains.mjs";
import * as enrolledFactory from "../../lib/db/enrolled-supabase-adapter";
import type { KeryxDB } from "../../lib/db/keryx-db";
import type { BrowserSigningSnapshot, BrowserSourceOriginalAdmission } from "../../lib/db/browser-signing-originals";
import { prepareBrowserJournal } from "../../lib/db/browser-authorization-journal";
import { prepareBrowserSourceSigningOriginal, verifyBrowserSigningHeader } from "../../lib/payments/browser-signing-original";
import { browserSourceContextPath, browserSourceRegistryId, type BrowserOriginalSourceContext } from "../../lib/payments/browser-original-source-context";
import type { Source, SourceItem } from "../../lib/types";

// This exercises the actual scenario function and real retained-original/ECDSA
// helpers against synthetic in-memory state. The spied factory assertion grants
// no installed-facade or PostgreSQL authority; hosted native acceptance is separate.
async function exerciseSeparatedBindingControl(
  scenario: "grant-lock" | "binding", damage: "none" | "lock" | "conflict" | "signature" = "none",
) {
  const identity: StorageIdentity = {
    format: "keryx-storage-identity-v1", network: "eip155:5042002", authorityMode: "testnet-real",
    deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
    enrolledAt: "2026-01-01T00:00:00.000Z", profileDigest: STORAGE_TESTNET_PROFILE_DIGEST,
    provenanceDigest: "0".repeat(64),
  };
  const creator = `0x${"11".repeat(20)}` as const;
  const payout = `0x${"22".repeat(20)}` as const;
  const deployment = { format: "keryx-storage-deployment-v1" as const, identity,
    backend: { kind: "supabase" as const, url: "https://synthetic.invalid" } };
  const authority = vi.spyOn(enrolledFactory, "assertEnrolledSupabaseAuthority").mockResolvedValue(deployment);
  const controls = { lock: 0, conflict: 0, foreignSignature: 0, foreignSignerRead: 0 };
  const stages: string[] = [];
  let source: Source;
  let item: SourceItem;
  let snapshot: BrowserSigningSnapshot;
  let controlBaseline: string;
  const state = () => JSON.stringify({ source, item, snapshot });
  const output = vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    const line = String(chunk).trim();
    if (line.startsWith("STAGE ")) stages.push(line.slice(6));
    if (line === "READY synthetic grant lock" || line === "READY synthetic grant refusal") {
      queueMicrotask(() => process.stdin.emit("data", Buffer.from("owned synthetic handshake\n")));
    }
    return true;
  });
  const db = {
    activateBrowserJournal: async () => undefined,
    upsertSessionGrant: async () => undefined,
    upsertSource: async (value: Source) => { source = structuredClone(value); },
    addItems: async (values: SourceItem[]) => { item = structuredClone(values[0]); },
    getItem: async () => structuredClone(item),
    admitBrowserQueryPolicy: async (proof: { policy: { queryId: string } }) => ({ status: "admitted", namespace: `0x${"44".repeat(32)}`, queryId: proof.policy.queryId }),
    admitBrowserSourceSigningOriginal: async (input: BrowserSourceOriginalAdmission) => {
      if (snapshot) {
        if (input.journal.requestId !== snapshot.original.requestId) {
          controls.lock++;
          if (damage === "lock") snapshot.query.spentMicros = "1001";
          throw new Error("Synthetic after-lock source deadline refusal");
        }
        controls.conflict++;
        expect(input.source.contentVersion).toBe("changed-version");
        if (damage === "conflict") snapshot.query.spentMicros = "1001";
        return { status: "refused" };
      }
      const journal = prepareBrowserJournal(input.journal);
      const context: BrowserOriginalSourceContext = {
        version: "source-context-v1", service: "https://keryx.cc", kind: "fetch",
        source: { sourceId: source.id, canonicalUrl: source.url, registryId: browserSourceRegistryId(creator, source.url) },
        item: { itemId: input.source.itemId, contentVersion: input.source.contentVersion },
        endpoint: { method: "GET", path: "pending" },
        registry: { network: "eip155:5042002", contract: `0x${"33".repeat(20)}`, blockNumber: "1",
          blockHash: `0x${"77".repeat(32)}`, blockTimestamp: String(Math.floor(Date.parse(journal.admittedAt) / 1000)),
          creator, payoutWallet: payout, listPriceMicros: "1000", active: true },
        price: { mode: "list", amountMicros: "1000" },
      };
      context.endpoint.path = browserSourceContextPath(context);
      const original = prepareBrowserSourceSigningOriginal(journal, input.queryNamespace, context);
      snapshot = { original, journal, query: { spentMicros: "1000" },
        signerSpentMicros: "1000", retainedEpochSpentMicros: "1000" } as BrowserSigningSnapshot;
      return { status: "admitted", journal: structuredClone(journal), original: structuredClone(original) };
    },
    exposeBrowserJournal: async () => { snapshot.journal.phase = "exposed"; return true; },
    signBrowserSigningOriginal: async (_session: string, _request: string, header: string) => {
      try { await verifyBrowserSigningHeader(snapshot.original, header); }
      catch (error) {
        controls.foreignSignature++;
        if (damage === "signature") snapshot.query.spentMicros = "1001";
        throw error;
      }
      snapshot.journal.phase = "signed";
      controlBaseline = state();
      return true;
    },
    readBrowserSigningSnapshot: async () => structuredClone(snapshot),
    readExposedBrowserSigningSnapshotForSigner: async () => { controls.foreignSignerRead++; return null; },
  } as unknown as KeryxDB;
  try {
    const result = await exerciseEnrolledSupabaseNativeDomains(db, identity, { creator, payout }, scenario);
    expect(state()).toBe(controlBaseline!);
    expect(authority).toHaveBeenCalledTimes(2);
    expect(result).toEqual([`native-browser-v3-${scenario}`]);
    return { controls, stages };
  } finally { output.mockRestore(); authority.mockRestore(); }
}

it("routes grant-lock expiry through both handshakes and retains its signed state without running conflict controls", async () => {
  const { controls, stages } = await exerciseSeparatedBindingControl("grant-lock");
  expect(controls).toEqual({ lock: 1, conflict: 0, foreignSignature: 0, foreignSignerRead: 1 });
  expect(stages).toContain("browser-grant-lock-expiry");
  expect(stages).not.toContain("browser-conflict-refusal");
});

it("routes original conflict and real foreign-signature refusal with unchanged signed state without waiting for a grant lock", async () => {
  const { controls, stages } = await exerciseSeparatedBindingControl("binding");
  expect(controls).toEqual({ lock: 0, conflict: 1, foreignSignature: 1, foreignSignerRead: 0 });
  expect(stages).toContain("browser-conflict-refusal");
  expect(stages).not.toContain("browser-grant-lock-expiry");
});

it.each(["lock", "conflict", "signature"] as const)("still fails when a %s refusal changes retained signed state", async damage => {
  await expect(exerciseSeparatedBindingControl(damage === "lock" ? "grant-lock" : "binding", damage))
    .rejects.toMatchObject({ code: "ERR_ASSERTION" });
});

