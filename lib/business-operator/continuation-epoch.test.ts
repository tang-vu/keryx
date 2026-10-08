import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../canonical-json";
import { fulfillmentSha256 as hash } from "../a2a/failed-original-fulfillment-protocol";
import { activateEpochAnchor, beginEpochLedgerUpdate, completeEpochLedgerUpdate, CONTINUATION_EPOCH2_LIMITS, fixedPaths, readActiveEpochAnchor, readLatestEpochAnchor,
  type ContinuationEpochBinding, type ContinuationEpochIO } from "./continuation-epoch";

const at = "2026-10-07T17:00:00.000Z", h = (digit: string) => digit.repeat(64);
const bytes = (value: unknown) => Buffer.from(`${canonicalJson(value)}\n`);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** State-machine tests inject the same exclusive/durable contract as production;
 * protected filesystem permissions and full native/ledger proof remain policy tests. */
function fixture() {
  const home = path.resolve("synthetic-epoch-home"), paths = fixedPaths(home);
  const files = new Map<string, Buffer>(), directories = new Set([home, paths.parentDirectory]);
  const events: string[] = [];
  const io: ContinuationEpochIO = {
    exists: file => files.has(file) || directories.has(file),
    read: file => { io.assertProtectedPath(file, false); return Buffer.from(files.get(file)!); },
    assertProtectedPath: (file, directory) => { if (!(directory ? directories : files).has(file)) throw Error("Missing protected fixture"); },
    list: directory => [...directories, ...files.keys()].filter(file => path.dirname(file) === directory).map(file => path.basename(file)),
    ensureDirectory: directory => { events.push(`directory:${directory}`); directories.add(directory); },
    retainRecord: (file, value) => {
      io.assertProtectedPath(path.dirname(file), true);
      if (io.exists(file)) throw Error("Exclusive record already exists");
      files.set(file, bytes(value)); events.push(`record:${file}`);
    },
    replaceRecordExact: (file, expected, value) => {
      if (hash(io.read(file)) !== expected) throw Error("Synthetic frontier CAS refused");
      files.set(file, bytes(value)); events.push(`replace:${file}`);
    },
    releaseRecordExact: (file, expected) => {
      if (hash(io.read(file)) !== expected) throw Error("Foreign lock cannot release");
      files.delete(file); events.push(`release:${file}`);
    },
  };
  const parentAuthorizationFile = path.join(home, "parent-grant.json"), authorizationFile = path.join(home, "fresh-grant.json");
  files.set(parentAuthorizationFile, bytes({ synthetic: "immutable-parent-grant" }));
  files.set(path.join(paths.parentDirectory, "ledger-head.json"), bytes({ synthetic: "eight-closed-parent-holds" }));
  const fields = { format: "keryx-original-continuation-authorization-v2" as const,
    historicalReservedMicroUsd: 243260 as const, maximumNewModelCalls: 6 as const, maximumCombinedMicroUsd: 400000 as const,
    parentAuthorizationFile, parentAuthorizationSha256: hash(files.get(parentAuthorizationFile)!),
    parentProviderLedgerSha256: h("1"), parentLedgerHeadSha256: hash(files.get(path.join(paths.parentDirectory, "ledger-head.json"))!),
    contextProtocol: "full-selected-bodies-required-sufficiency-v1" as const,
    originalAuthorizationSha256: h("2"), nativeClaimSha256: h("3"), inputSemanticSha256: h("4"), packetSha256: h("5"),
    executionHostSha256: h("6"), executorCommit: "a".repeat(40), ownerAuthorizationSha256: h("7"),
    ownerAuthorizationReceivedAt: "2026-10-07T15:20:44.000Z", approvedAt: "2026-10-07T16:30:00.000Z",
    expiresAt: "2026-10-08T15:20:44.000Z", maximumDurationMs: 86400000 as const };
  files.set(authorizationFile, bytes({ ...fields, otherSharedFields: "validated-by-parent-policy" }));
  const binding: ContinuationEpochBinding = { ...fields, authorizationFile, authorizationSha256: hash(files.get(authorizationFile)!) };
  const initializeJournal = vi.fn(() => {
    expect(io.exists(paths.intentFile)).toBe(true);
    expect(io.exists(paths.lockFile)).toBe(true);
    expect(io.exists(paths.epochDirectory)).toBe(false);
    io.ensureDirectory(paths.epochDirectory);
    io.retainRecord(path.join(paths.epochDirectory, "authorization.json"), {
      format: "keryx-original-continuation-retained-authorization-v1", authorizationFile, authorizationSha256: binding.authorizationSha256 });
    io.retainRecord(path.join(paths.epochDirectory, "ledger-head.json"), { synthetic: "fresh-no-holds" });
  });
  const validateAuthority = vi.fn(async () => {});
  return { home, paths, files, directories, events, io, binding, initializeJournal, validateAuthority,
    activation: { initializeJournal, validateAuthority } };
}

async function supplementFixture() {
  const f = fixture(); await activateEpochAnchor(f.home, f.binding, f.io, f.activation);
  const token = beginEpochLedgerUpdate(f.home, f.io), parentHeadFile = path.join(f.paths.epochDirectory, "ledger-head.json");
  const head = bytes({ synthetic: "one-acknowledged-negative-assessment" }); f.files.set(parentHeadFile, head);
  const parent = completeEpochLedgerUpdate(token, hash(head), f.io), paths = fixedPaths(f.home, 3);
  const supplementaryInputFile = path.join(f.home, "synthetic-free-supplement.json");
  f.files.set(supplementaryInputFile, bytes({ synthetic: "separately-bound-free-primary-evidence" }));
  const fields = { ...f.binding, format: "keryx-original-continuation-authorization-v3" as const,
    historicalReservedMicroUsd: 263920 as const, maximumNewModelCalls: 5 as const, maximumCombinedMicroUsd: 367220 as const,
    ownerMaximumCombinedMicroUsd: 400000 as const,
    parentAuthorizationFile: f.binding.authorizationFile, parentAuthorizationSha256: f.binding.authorizationSha256,
    parentProviderLedgerSha256: h("8"), parentLedgerHeadSha256: parent.ledgerHeadSha256,
    parentAnchorIntentSha256: parent.intentSha256, parentAnchorActiveSha256: parent.activeSha256, parentAnchorFrontierSha256: parent.frontierSha256,
    parentSufficiencyHoldSha256: h("9"), parentSufficiencyCheckpointSha256: h("a"), parentSufficiencyResultSha256: h("b"),
    parentSufficiencyDiagnosticSha256: h("c"), parentAttemptOutcomeSha256: h("d"),
    supplementaryInputFile, supplementaryInputSha256: hash(f.files.get(supplementaryInputFile)!), contextSha256: h("e"),
    contextProtocol: "full-selected-bodies-required-sufficiency-with-free-primary-supplement-v1" as const,
    authorizationFile: path.join(f.home, "fresh-epoch-3-grant.json") };
  const { authorizationFile, authorizationSha256: _oldSha, ...grant } = fields;
  f.files.set(authorizationFile, bytes(grant));
  const binding: ContinuationEpochBinding = { ...fields, authorizationSha256: hash(f.files.get(authorizationFile)!) };
  const initializeJournal = vi.fn(() => {
    expect(f.io.exists(paths.intentFile)).toBe(true);
    f.io.ensureDirectory(paths.epochDirectory);
    f.io.retainRecord(path.join(paths.epochDirectory, "authorization.json"), {
      format: "keryx-original-continuation-retained-authorization-v1", authorizationFile, authorizationSha256: binding.authorizationSha256 });
    f.io.retainRecord(path.join(paths.epochDirectory, "ledger-head.json"), { synthetic: "remaining-five-unused" });
  });
  return { ...f, parent, paths3: paths, binding3: binding, activation3: { initializeJournal, validateAuthority: vi.fn(async () => {}) } };
}
async function preparedFixture() {
  const f = await supplementFixture(); await activateEpochAnchor(f.home, f.binding3, f.io, f.activation3);
  const token = beginEpochLedgerUpdate(f.home, f.io), parentHeadFile = path.join(f.paths3.epochDirectory, "ledger-head.json");
  const head = bytes({ synthetic: "three-returned-stages-positive-prepared" }); f.files.set(parentHeadFile, head);
  const parent = completeEpochLedgerUpdate(token, hash(head), f.io), paths = fixedPaths(f.home, 4);
  const preparedFile = path.join(f.paths3.epochDirectory, "prepared-result.json");
  f.files.set(preparedFile, bytes({ synthetic: "immutable-quality-rejected-prepared" }));
  const rootQualityRejectionFile = path.join(f.home, "synthetic-root-quality-rejection.json"),
    independentQualityRejectionFile = path.join(f.home, "synthetic-independent-quality-rejection.json");
  f.files.set(rootQualityRejectionFile, bytes({ synthetic: "root-rejection" }));
  f.files.set(independentQualityRejectionFile, bytes({ synthetic: "independent-rejection" }));
  const authorizationFile = path.join(f.home, "fresh-epoch-4-grant.json"), fields = { ...f.binding,
    format: "keryx-original-continuation-authorization-v4" as const, historicalReservedMicroUsd: 325900 as const,
    maximumNewModelCalls: 2 as const, maximumCombinedMicroUsd: 367220 as const, ownerMaximumCombinedMicroUsd: 400000 as const,
    parentAuthorizationFile: f.binding3.authorizationFile, parentAuthorizationSha256: f.binding3.authorizationSha256,
    parentProviderLedgerSha256: h("8"), parentLedgerHeadSha256: parent.ledgerHeadSha256,
    parentAnchorIntentSha256: parent.intentSha256, parentAnchorActiveSha256: parent.activeSha256, parentAnchorFrontierSha256: parent.frontierSha256,
    parentPreparedResultSha256: hash(f.files.get(preparedFile)!), parentRunSha256: h("9"),
    parentSufficiencyHoldSha256: h("a"), parentSufficiencyCheckpointSha256: h("b"), parentSufficiencyResultSha256: h("c"),
    parentSufficiencyPromptSha256: h("d"), supplementaryInputFile: f.binding3.format === "keryx-original-continuation-authorization-v3" ? f.binding3.supplementaryInputFile : "",
    supplementaryInputSha256: f.binding3.format === "keryx-original-continuation-authorization-v3" ? f.binding3.supplementaryInputSha256 : "",
    contextSha256: h("e"), rootQualityRejectionFile, rootQualityRejectionSha256: hash(f.files.get(rootQualityRejectionFile)!),
    independentQualityRejectionFile, independentQualityRejectionSha256: hash(f.files.get(independentQualityRejectionFile)!),
    contextProtocol: "full-same-evidence-required-quality-refresh-v1" as const };
  const { authorizationFile: _priorFile, authorizationSha256: _priorSha, ...grant } = fields;
  f.files.set(authorizationFile, bytes(grant));
  const binding: ContinuationEpochBinding = { ...grant, authorizationFile, authorizationSha256: hash(f.files.get(authorizationFile)!) };
  const initializeJournal = vi.fn(() => {
    expect(f.io.exists(paths.intentFile)).toBe(true); f.io.ensureDirectory(paths.epochDirectory);
    f.io.retainRecord(path.join(paths.epochDirectory, "authorization.json"), {
      format: "keryx-original-continuation-retained-authorization-v1", authorizationFile, authorizationSha256: binding.authorizationSha256 });
    f.io.retainRecord(path.join(paths.epochDirectory, "ledger-head.json"), { synthetic: "two-new-quality-holds-unused" });
  });
  return { ...f, parent3: parent, paths4: paths, binding4: binding,
    activation4: { initializeJournal, validateAuthority: vi.fn(async () => {}) } };
}

describe("irreversible separate continuation epoch authority", () => {
  it("activates only after fresh proof and external intent, preserving every parent byte", async () => {
    const f = fixture(), original = new Map([...f.files].map(([file, raw]) => [file, Buffer.from(raw)]));
    expect(readActiveEpochAnchor(f.home, f.io)).toBeNull();
    const result = await activateEpochAnchor(f.home, f.binding, f.io, f.activation);
    expect(f.validateAuthority).toHaveBeenCalledTimes(2);
    expect(f.initializeJournal).toHaveBeenCalledOnce();
    expect(result.binding).toEqual(f.binding);
    expect(result.paths.epochDirectory).not.toBe(result.paths.parentDirectory);
    expect(path.dirname(result.paths.intentFile)).not.toBe(result.paths.epochDirectory);
    expect(f.io.exists(f.paths.lockFile)).toBe(false);
    expect(readActiveEpochAnchor(f.home, f.io)).toEqual(result);
    for (const [file, raw] of original) expect(f.files.get(file)).toEqual(raw);
    expect(f.events.indexOf(`record:${f.paths.intentFile}`)).toBeLessThan(f.events.indexOf(`directory:${f.paths.epochDirectory}`));
    await expect(activateEpochAnchor(f.home, f.binding, f.io, f.activation)).rejects.toThrow("uncertain");
    expect(f.initializeJournal).toHaveBeenCalledOnce();
    expect(CONTINUATION_EPOCH2_LIMITS.historicalReservedMicroUsd +
      CONTINUATION_EPOCH2_LIMITS.maximumNewModelCalls * CONTINUATION_EPOCH2_LIMITS.reserveMicroUsd).toBe(367220);
  });

  it.each(["intent", "frontier", "active"] as const)("retains the exact external lock after lost %s publication acknowledgement", async phase => {
    const f = fixture(), retain = f.io.retainRecord;
    f.io.retainRecord = (file, value) => { retain(file, value); if (file === (phase === "intent" ? f.paths.intentFile : phase === "frontier" ? f.paths.frontierFile : f.paths.activeFile)) throw Error("Synthetic fsync uncertainty"); };
    await expect(activateEpochAnchor(f.home, f.binding, f.io, f.activation)).rejects.toThrow("fsync uncertainty");
    expect(f.io.exists(f.paths.lockFile)).toBe(true);
    expect(f.io.exists(f.paths.intentFile)).toBe(true);
    expect(f.initializeJournal).toHaveBeenCalledTimes(phase === "intent" ? 0 : 1);
    expect(() => readActiveEpochAnchor(f.home, f.io)).toThrow("uncertain");
    await expect(activateEpochAnchor(f.home, f.binding, f.io, f.activation)).rejects.toThrow("uncertain");
  });

  it("retains intent and lock when fresh authority changes after journal initialization", async () => {
    const f = fixture();
    f.validateAuthority.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("Synthetic native authority changed"));
    await expect(activateEpochAnchor(f.home, f.binding, f.io, f.activation)).rejects.toThrow("native authority changed");
    expect(f.io.exists(f.paths.lockFile)).toBe(true); expect(f.io.exists(f.paths.intentFile)).toBe(true);
    expect(f.io.exists(f.paths.activeFile)).toBe(false);
    expect(() => readActiveEpochAnchor(f.home, f.io)).toThrow("uncertain");
  });

  it("leaves its external fence when the owner deadline expires during initialization", async () => {
    const f = fixture();
    f.validateAuthority.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => { vi.setSystemTime(f.binding.expiresAt); });
    await expect(activateEpochAnchor(f.home, f.binding, f.io, f.activation)).rejects.toThrow("uncertain");
    expect(f.io.exists(f.paths.lockFile)).toBe(true);
    expect(f.io.exists(f.paths.intentFile)).toBe(true);
    expect(f.io.exists(f.paths.activeFile)).toBe(false);
  });

  it("never creates an intent or journal when the initial fresh native proof refuses", async () => {
    const f = fixture(); f.validateAuthority.mockRejectedValue(Error("Synthetic original already changed"));
    await expect(activateEpochAnchor(f.home, f.binding, f.io, f.activation)).rejects.toThrow("original already changed");
    expect(f.io.exists(f.paths.intentFile)).toBe(false); expect(f.io.exists(f.paths.epochDirectory)).toBe(false);
    expect(f.events).toEqual([]);
  });

  it("fences uncertain normal lock-release acknowledgement without resuming", async () => {
    const f = fixture(), release = f.io.releaseRecordExact;
    f.io.releaseRecordExact = (file, expected) => { release(file, expected); throw Error("Synthetic release flush uncertainty"); };
    await expect(activateEpochAnchor(f.home, f.binding, f.io, f.activation)).rejects.toThrow("release flush uncertainty");
    expect(f.io.exists(f.paths.activeFile)).toBe(true);
    expect(f.io.exists(f.paths.uncertainFile)).toBe(true);
    expect(() => readActiveEpochAnchor(f.home, f.io)).toThrow("uncertain");
  });

  it.each(["grant", "journal", "retained-grant", "parent-head"] as const)("refuses a missing or changed %s after activation instead of falling back", async kind => {
    const f = fixture(); await activateEpochAnchor(f.home, f.binding, f.io, f.activation);
    if (kind === "grant") f.files.delete(f.binding.authorizationFile);
    if (kind === "journal") f.directories.delete(f.paths.epochDirectory);
    if (kind === "retained-grant") f.files.delete(path.join(f.paths.epochDirectory, "authorization.json"));
    if (kind === "parent-head") f.files.set(path.join(f.paths.parentDirectory, "ledger-head.json"), bytes({ synthetic: "changed-parent-head" }));
    expect(() => readActiveEpochAnchor(f.home, f.io)).toThrow();
  });

  it.each(["intent-hash", "directory"] as const)("rejects a counterfeit active %s binding", async kind => {
    const f = fixture(); await activateEpochAnchor(f.home, f.binding, f.io, f.activation);
    const active = JSON.parse(f.files.get(f.paths.activeFile)!.toString("utf8"));
    if (kind === "intent-hash") active.intentSha256 = h("9");
    else active.directory = f.paths.parentDirectory;
    f.files.set(f.paths.activeFile, bytes(active));
    expect(() => readActiveEpochAnchor(f.home, f.io)).toThrow("uncertain");
  });

  it("refuses orphan journals, foreign locks and unknown anchor files without takeover", async () => {
    const orphan = fixture(); orphan.directories.add(orphan.paths.epochDirectory);
    expect(() => readActiveEpochAnchor(orphan.home, orphan.io)).toThrow("uncertain");
    const locked = fixture(); locked.directories.add(locked.paths.anchorDirectory); locked.files.set(locked.paths.lockFile, bytes({ synthetic: "foreign-lock" }));
    await expect(activateEpochAnchor(locked.home, locked.binding, locked.io, locked.activation)).rejects.toThrow("uncertain");
    expect(locked.files.get(locked.paths.lockFile)).toEqual(bytes({ synthetic: "foreign-lock" }));
    const unknown = fixture(); unknown.directories.add(unknown.paths.anchorDirectory); unknown.files.set(path.join(unknown.paths.anchorDirectory, "foreign.json"), bytes({ synthetic: true }));
    expect(() => readActiveEpochAnchor(unknown.home, unknown.io)).toThrow("uncertain");
  });

  it("permits only one concurrent activation and never closes another invocation's lock", async () => {
    const f = fixture(); let unblock!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    f.validateAuthority.mockImplementation(() => gate);
    const first = activateEpochAnchor(f.home, f.binding, f.io, f.activation), second = activateEpochAnchor(f.home, f.binding, f.io, f.activation);
    unblock();
    const results = await Promise.allSettled([first, second]);
    expect(results.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(f.initializeJournal).toHaveBeenCalledOnce();
    expect(f.events.filter(event => event === `release:${f.paths.lockFile}`)).toHaveLength(1);
  });

  it("keeps the original owner deadline and refuses expanded literals or altered grant bindings", async () => {
    const f = fixture();
    await expect(activateEpochAnchor(f.home, { ...f.binding, maximumNewModelCalls: 8 } as unknown as ContinuationEpochBinding, f.io, f.activation)).rejects.toThrow();
    await expect(activateEpochAnchor(f.home, { ...f.binding, expiresAt: "2026-10-08T15:20:44.001Z" }, f.io, f.activation)).rejects.toThrow();
    await expect(activateEpochAnchor(f.home, { ...f.binding, nativeClaimSha256: h("9") }, f.io, f.activation)).rejects.toThrow("uncertain");
    vi.setSystemTime(f.binding.expiresAt);
    await expect(activateEpochAnchor(f.home, f.binding, f.io, f.activation)).rejects.toThrow("uncertain");
    expect(f.events).toEqual([]);
  });

  it("refuses parent grant paths inside any journal/anchor or relative to the caller", async () => {
    const f = fixture();
    for (const directory of [f.paths.parentDirectory, f.paths.epochDirectory, f.paths.anchorDirectory]) {
      await expect(activateEpochAnchor(f.home, { ...f.binding, parentAuthorizationFile: path.join(directory, "grant.json") }, f.io, f.activation))
        .rejects.toThrow("uncertain");
    }
    await expect(activateEpochAnchor(f.home, { ...f.binding, parentAuthorizationFile: "relative-grant.json" }, f.io, f.activation))
      .rejects.toThrow("uncertain");
    expect(f.events).toEqual([]);
  });

  it("commits every latest head externally and rejects a whole-journal rollback", async () => {
    const f = fixture(); await activateEpochAnchor(f.home, f.binding, f.io, f.activation);
    const headFile = path.join(f.paths.epochDirectory, "ledger-head.json"), initialHead = Buffer.from(f.files.get(headFile)!);
    const update = beginEpochLedgerUpdate(f.home, f.io);
    expect(f.io.exists(f.paths.ledgerUpdateLockFile)).toBe(true);
    expect(() => readActiveEpochAnchor(f.home, f.io)).toThrow("uncertain");
    const nextHead = bytes({ synthetic: "fresh-hold-irreversibly-consumed" });
    f.files.set(headFile, nextHead);
    const anchor = completeEpochLedgerUpdate(update, hash(nextHead), f.io);
    expect(anchor.ledgerHeadSha256).toBe(hash(nextHead));
    expect(f.io.exists(f.paths.ledgerUpdateLockFile)).toBe(false);
    // Restoring the mutable journal's original grant/head cannot restore allowance.
    f.files.set(headFile, initialHead);
    expect(() => readActiveEpochAnchor(f.home, f.io)).toThrow("uncertain");
    expect(() => beginEpochLedgerUpdate(f.home, f.io)).toThrow("uncertain");
  });

  it.each(["after-head", "frontier-publication"] as const)("retains an external pending update after %s failure and refuses takeover", async phase => {
    const f = fixture(); await activateEpochAnchor(f.home, f.binding, f.io, f.activation);
    const token = beginEpochLedgerUpdate(f.home, f.io), headFile = path.join(f.paths.epochDirectory, "ledger-head.json");
    const nextHead = bytes({ synthetic: "pending-held-request" }); f.files.set(headFile, nextHead);
    if (phase === "frontier-publication") {
      const replace = f.io.replaceRecordExact;
      f.io.replaceRecordExact = (file, prior, value) => { replace(file, prior, value); throw Error("Synthetic frontier flush uncertainty"); };
      expect(() => completeEpochLedgerUpdate(token, hash(nextHead), f.io)).toThrow("frontier flush uncertainty");
    }
    expect(f.io.exists(f.paths.ledgerUpdateLockFile)).toBe(true);
    expect(() => readActiveEpochAnchor(f.home, f.io)).toThrow("uncertain");
    expect(() => beginEpochLedgerUpdate(f.home, f.io)).toThrow("uncertain");
    expect(() => completeEpochLedgerUpdate({}, hash(nextHead), f.io)).toThrow("uncertain");
  });

  it("does not release an uncertain update when its next head or frontier CAS differs", async () => {
    const f = fixture(); await activateEpochAnchor(f.home, f.binding, f.io, f.activation);
    const token = beginEpochLedgerUpdate(f.home, f.io), lock = Buffer.from(f.files.get(f.paths.ledgerUpdateLockFile)!);
    expect(() => completeEpochLedgerUpdate(token, h("9"), f.io)).toThrow("uncertain");
    expect(f.files.get(f.paths.ledgerUpdateLockFile)).toEqual(lock);
    expect(() => completeEpochLedgerUpdate(token, h("9"), f.io)).toThrow("uncertain");
  });

  it("fences a failed update-lock release without allowing a second completion", async () => {
    const f = fixture(); await activateEpochAnchor(f.home, f.binding, f.io, f.activation);
    const token = beginEpochLedgerUpdate(f.home, f.io), headFile = path.join(f.paths.epochDirectory, "ledger-head.json");
    const nextHead = bytes({ synthetic: "acknowledged-head-uncertain-release" }); f.files.set(headFile, nextHead);
    const release = f.io.releaseRecordExact;
    f.io.releaseRecordExact = (file, expected) => { release(file, expected); throw Error("Synthetic update release uncertainty"); };
    expect(() => completeEpochLedgerUpdate(token, hash(nextHead), f.io)).toThrow("update release uncertainty");
    expect(f.io.exists(f.paths.ledgerUpdateUncertainFile)).toBe(true);
    expect(() => readActiveEpochAnchor(f.home, f.io)).toThrow("uncertain");
    expect(() => completeEpochLedgerUpdate(token, hash(nextHead), f.io)).toThrow("uncertain");
  });
});

describe("immutable prepared-quality successor frontier", () => {
  it("activates the exact two-slot successor without altering any prior journal, prepared result or rejection proof", async () => {
    const f = await preparedFixture(), previous = new Map([...f.files].map(([file, raw]) => [file, Buffer.from(raw)]));
    const active = await activateEpochAnchor(f.home, f.binding4, f.io, f.activation4);
    expect(active.paths.epoch).toBe(4); expect(readLatestEpochAnchor(f.home, f.io)).toEqual(active);
    expect(active.binding.historicalReservedMicroUsd + active.binding.maximumNewModelCalls * 20660).toBe(367220);
    expect(readActiveEpochAnchor(f.home, f.io, 3)).toEqual(f.parent3);
    for (const [file, raw] of previous) expect(f.files.get(file)).toEqual(raw);
    expect(f.activation4.validateAuthority).toHaveBeenCalledTimes(2);
  });
  it("blocks all fallback on uncertain successor publication and refuses a new full-journal rollback", async () => {
    const f = await preparedFixture(), retain = f.io.retainRecord;
    f.io.retainRecord = (file, value) => { retain(file, value); if (file === f.paths4.activeFile) throw Error("Synthetic fourth activation acknowledgement lost"); };
    await expect(activateEpochAnchor(f.home, f.binding4, f.io, f.activation4)).rejects.toThrow("acknowledgement lost");
    expect(readActiveEpochAnchor(f.home, f.io, 3)).toEqual(f.parent3);
    expect(() => readLatestEpochAnchor(f.home, f.io)).toThrow();
    expect(() => beginEpochLedgerUpdate(f.home, f.io)).toThrow();
    const other = await preparedFixture(); await activateEpochAnchor(other.home, other.binding4, other.io, other.activation4);
    const headFile = path.join(other.paths4.epochDirectory, "ledger-head.json"), initial = Buffer.from(other.files.get(headFile)!);
    const token = beginEpochLedgerUpdate(other.home, other.io), next = bytes({ synthetic: "fresh-generation-hold" });
    other.files.set(headFile, next); expect(completeEpochLedgerUpdate(token, hash(next), other.io).paths.epoch).toBe(4);
    other.files.set(headFile, initial); expect(() => readLatestEpochAnchor(other.home, other.io)).toThrow();
  });
});

describe("fixed remaining-five successor profile", () => {
  it("chains separate immutable parent anchors and transfers only the remaining five holds", async () => {
    const f = await supplementFixture(), previous = new Map([...f.files].map(([file, raw]) => [file, Buffer.from(raw)]));
    const activated = await activateEpochAnchor(f.home, f.binding3, f.io, f.activation3);
    expect(activated.paths.epoch).toBe(3);
    expect(activated.binding.maximumNewModelCalls).toBe(5);
    expect(activated.binding.historicalReservedMicroUsd + 5 * 20660).toBe(367220);
    expect(readLatestEpochAnchor(f.home, f.io)?.binding).toEqual(f.binding3);
    expect(readActiveEpochAnchor(f.home, f.io, 2)).toEqual(f.parent);
    for (const [file, raw] of previous) expect(f.files.get(file)).toEqual(raw);
    expect([...f.io.list(f.paths.anchorDirectory)].sort()).toEqual(["epoch-2-active.json", "epoch-2-intent.json", "frontier.json"]);
  });

  it("blocks all fallback on a partial successor even while the parent remains valid metadata", async () => {
    const f = await supplementFixture(), retain = f.io.retainRecord;
    f.io.retainRecord = (file, value) => { retain(file, value); if (file === f.paths3.activeFile) throw Error("Synthetic successor acknowledgement lost"); };
    await expect(activateEpochAnchor(f.home, f.binding3, f.io, f.activation3)).rejects.toThrow("acknowledgement lost");
    expect(readActiveEpochAnchor(f.home, f.io, 2)).toEqual(f.parent);
    expect(() => readLatestEpochAnchor(f.home, f.io)).toThrow("uncertain");
    expect(() => beginEpochLedgerUpdate(f.home, f.io)).toThrow("uncertain");
  });

  it("anchors successor updates separately and rejects rollback of either epoch", async () => {
    const f = await supplementFixture(); await activateEpochAnchor(f.home, f.binding3, f.io, f.activation3);
    const initial = Buffer.from(f.files.get(path.join(f.paths3.epochDirectory, "ledger-head.json"))!);
    const token = beginEpochLedgerUpdate(f.home, f.io);
    expect(f.io.exists(f.paths3.ledgerUpdateLockFile)).toBe(true);
    expect(f.io.exists(f.paths.ledgerUpdateLockFile)).toBe(false);
    const next = bytes({ synthetic: "successor-first-hold" }); f.files.set(path.join(f.paths3.epochDirectory, "ledger-head.json"), next);
    expect(completeEpochLedgerUpdate(token, hash(next), f.io).paths.epoch).toBe(3);
    f.files.set(path.join(f.paths3.epochDirectory, "ledger-head.json"), initial);
    expect(() => readLatestEpochAnchor(f.home, f.io)).toThrow("uncertain");
    f.files.set(path.join(f.paths3.epochDirectory, "ledger-head.json"), next);
    f.files.set(path.join(f.paths.epochDirectory, "ledger-head.json"), bytes({ synthetic: "rolled-back-parent" }));
    expect(() => readLatestEpochAnchor(f.home, f.io)).toThrow("uncertain");
  });

  it("does not accept a renewed deadline, new six-call allowance or changed parent frontier", async () => {
    const f = await supplementFixture();
    await expect(activateEpochAnchor(f.home, { ...f.binding3, maximumNewModelCalls: 6 } as unknown as ContinuationEpochBinding, f.io, f.activation3)).rejects.toThrow();
    await expect(activateEpochAnchor(f.home, { ...f.binding3, expiresAt: "2026-10-08T15:20:44.001Z" }, f.io, f.activation3)).rejects.toThrow();
    await expect(activateEpochAnchor(f.home, { ...f.binding3, parentAnchorFrontierSha256: h("f") } as ContinuationEpochBinding, f.io, f.activation3)).rejects.toThrow("uncertain");
    expect(f.io.exists(f.paths3.intentFile)).toBe(false);
    expect(() => fixedPaths(f.home, 5 as 2)).toThrow("uncertain");
  });
});
