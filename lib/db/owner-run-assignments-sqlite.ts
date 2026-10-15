import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { interactiveSessionSchema, membershipSchema, digestSchema, timeSchema, type InteractiveSession } from "../accounts/contracts";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteForeignKeys, assertVerifiedSqliteNativeUserDomainPolicy,
  assertVerifiedSqliteSelectedApplicationPolicy, assertVerifiedSqliteWritePolicy } from "./storage-identity-connection";
import { storageIdentityDigest } from "./storage-identity";
import { AssignmentError, CONSENT_TTL_MS, EVENT_BYTES, associationSchema, eventSchema, ownerActionSchema,
  receiptSchema, recipientActionSchema, recipientSchema, type Association, type AssignmentEvent, type Manifest,
  type OwnerAction, type OwnerRunAssignmentsPort, type Receipt, type Recipient } from "../owner-run-assignments/contracts";
import { assignmentDigest, parseManifest } from "../owner-run-assignments/protocol";
import { assertLocalOwner, type LocalOwnerAuthorization } from "../owner-run-assignments/local-owner";
import { projectAssignment } from "../owner-run-assignments/projection";
import { OWNER269_OCCUPANCY_PROPOSAL } from "../owner-run-assignments/occupancy-proposal";

const fail = (code: ConstructorParameters<typeof AssignmentError>[0] = "assignment_unavailable"): never => { throw new AssignmentError(code); };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const active = (row: Association) => row.status === "assigned-by-owner" || row.status === "claimed";
const contention = (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
  && "errcode" in error && (error.errcode === 5 || error.errcode === 6);
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff" };

export interface NativeOwnerRunAssignments extends OwnerRunAssignmentsPort {
  stage(manifest: Manifest, consentId?: string): { version: 1; manifest: Manifest; manifestDigest: string; applicable: boolean; holds: string[] };
  owner(input: OwnerAction, authorization: LocalOwnerAuthorization): Receipt;
  lookupOwner(input: OwnerAction, authorization: LocalOwnerAuthorization): { status: "committed"; receipt: Receipt } | { status: "absent" };
}

/** One genuine selected connection only. No ordinary fallback, DDL, reference DB,
 * supplied guard/verified boolean, session cache, provider or financial method. */
export function createEnrolledSqliteOwnerRunAssignments(db: DatabaseSync): NativeOwnerRunAssignments | undefined {
  if (arguments.length !== 1) return fail();
  let admitted = false, retired = false;
  let identity: ReturnType<typeof assertVerifiedSqliteConnection>;
  const retire = () => { retired = true; if (admitted) { try { db.close(); } catch { /* Permanent uncertainty. */ } } };
  try {
    assertVerifiedSqliteForeignKeys(db); admitted = true;
    assertVerifiedSqliteSelectedApplicationPolicy(db); identity = assertVerifiedSqliteConnection(db);
  } catch (error) { if (!contention(error)) retire(); return fail(); }
  // Full source guard above already proved a source-known BEFORE or complete bundle.
  try { assertVerifiedSqliteNativeUserDomainPolicy(db); } catch { return undefined; }
  const storageDigest = storageIdentityDigest(identity);
  const guard = (write = false) => {
    if (retired) return fail();
    // Metadata-only readonly rejection must precede even request parsing or SQL.
    if (write) { try { assertVerifiedSqliteWritePolicy(db); } catch { return fail(); } }
    try {
      assertVerifiedSqliteForeignKeys(db); assertVerifiedSqliteNativeUserDomainPolicy(db);
      assertVerifiedSqliteSelectedApplicationPolicy(db); assertVerifiedSqliteConnection(db);
    } catch (error) { if (!contention(error)) retire(); throw error; }
  };
  function transaction<T>(write: boolean, action: (now: number) => T): T {
    guard(write);
    let begun = false, committing = false;
    try {
      if (db.isTransaction) { retire(); return fail(); }
      db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN"); begun = true;
      guard();
      const now = timeSchema.parse(db.prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now").get()?.now);
      const value = action(now); guard();
      committing = true; db.exec("COMMIT"); begun = false; guard();
      return value;
    } catch (error) {
      if (committing && !contention(error)) { retire(); return fail("assignment_outcome_unresolved"); }
      let clean = false;
      try { if (begun && db.isTransaction) db.exec("ROLLBACK"); if (!db.isTransaction) { guard(); clean = true; } }
      catch { retire(); }
      const benign = error instanceof AssignmentError && !["assignment_unavailable", "assignment_outcome_unresolved"].includes(error.code);
      if (!clean || !benign && !contention(error)) retire();
      if (retired || contention(error)) return fail();
      throw error;
    }
  }
  function binding(manifest: Manifest) {
    if (manifest.binding.storageDigest !== storageDigest || manifest.binding.network !== identity.network) fail("assignment_ineligible");
  }
  function known(target: Recipient) {
    const a = db.prepare("SELECT account_id,created_at,revision FROM account267_accounts WHERE account_id=?").get(target.accountId);
    const members = db.prepare("SELECT wallet,generation,linked_at FROM account267_members WHERE account_id=? ORDER BY wallet LIMIT 9").all(target.accountId);
    const credentials = db.prepare("SELECT wallet,member_generation,generation,login_after,active FROM account267_credentials WHERE account_id=? ORDER BY wallet LIMIT 9").all(target.accountId);
    if (!a || a.created_at !== target.accountCreatedAt) return fail("assignment_unauthenticated");
    membershipSchema.parse({ version: 1, accountId: a.account_id, revision: a.revision, createdAt: a.created_at,
      members: members.map(m => ({ wallet: m.wallet, generation: m.generation, linkedAt: m.linked_at })) });
    if (credentials.length !== members.length || credentials.some((c, i) => c.wallet !== members[i].wallet
      || c.member_generation !== members[i].generation || !digestSchema.safeParse(c.generation).success
      || !timeSchema.safeParse(c.login_after).success || c.active !== 0 && c.active !== 1)
      || new Set(credentials.map(c => c.generation)).size !== members.length) return fail();
    const member = members.find(m => m.wallet === target.wallet && m.generation === target.memberGeneration);
    const credential = credentials.find(c => c.wallet === target.wallet && c.member_generation === target.memberGeneration && c.active === 1);
    if (!member || !credential) return fail("assignment_unauthenticated");
    return { generation: digestSchema.parse(credential.generation), loginAfter: timeSchema.parse(credential.login_after) };
  }
  function actor(raw: InteractiveSession, now: number) {
    const s = interactiveSessionSchema.parse(raw);
    const web = db.prepare("SELECT hash,wallet,issued_at,expires_at FROM web_sessions WHERE hash=?").get(s.sessionHash);
    const session = db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(s.sessionHash);
    if (!web || web.wallet !== s.wallet || web.issued_at !== s.issuedAt || web.expires_at !== s.expiresAt
      || s.issuedAt > now || s.expiresAt <= now || !session || session.revoked_at !== null || session.history_consent !== 1
      || session.wallet !== s.wallet || session.issued_at !== s.issuedAt || session.expires_at !== s.expiresAt
      || session.network !== identity.network) return fail("assignment_unauthenticated");
    const a = db.prepare("SELECT created_at FROM account267_accounts WHERE account_id=?").get(session.account_id as string);
    const recipient = recipientSchema.parse({ accountId: session.account_id, accountCreatedAt: a?.created_at,
      wallet: s.wallet, memberGeneration: session.member_generation });
    const credential = known(recipient);
    if (credential.generation !== session.credential_generation || s.issuedAt < credential.loginAfter) return fail("assignment_unauthenticated");
    const origin = z.string().url().parse(session.origin);
    if (new URL(origin).origin !== origin) return fail();
    return { recipient, credentialGeneration: credential.generation, origin };
  }
  function original(manifest: Manifest, member: Manifest["members"][number], now: number) {
    binding(manifest);
    const row = db.prepare(`SELECT id,asker,created_at,typeof(data) AS data_type,length(CAST(data AS BLOB)) AS bytes,
      CASE WHEN typeof(data)='text' AND length(CAST(data AS BLOB))<=4000000 THEN CAST(data AS BLOB) END AS raw
      FROM query_runs WHERE id=?`).get(member.runId);
    if (!row || row.asker !== null || row.created_at !== member.completedAt || Date.parse(member.completedAt) > now
      || row.data_type !== "text" || !(row.raw instanceof Uint8Array) || row.bytes !== row.raw.byteLength
      || createHash("sha256").update(row.raw).digest("hex") !== member.originalSha256
      || db.prepare("SELECT 1 FROM a2a_orders WHERE query_id=? LIMIT 1").get(member.runId)
      || db.prepare("SELECT 1 FROM anonymous_run_claims WHERE run_id=? LIMIT 1").get(member.runId)) return fail("assignment_ineligible");
    const run = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(row.raw));
    if (!run || typeof run !== "object" || Array.isArray(run) || run.id !== member.runId || run.createdAt !== member.completedAt
      || Object.hasOwn(run, "asker") || Object.hasOwn(run, "originalFulfillment") || run.askerFunded === true
      || run.fundingOwner === "browser") return fail("assignment_ineligible");
    const privacy = db.prepare("SELECT visibility,erased FROM run_privacy WHERE run_id=?").get(member.runId);
    if (privacy && (privacy.erased !== 0 || !["public", "unlisted"].includes(privacy.visibility as string))) return fail("assignment_ineligible");
    // Existing retained economic rows independently bind historical network. Zero,
    // unknown or mixed provenance is not repaired using today's deployment config.
    const rails = db.prepare("SELECT DISTINCT network FROM payment_events WHERE query_id=? LIMIT 3").all(member.runId);
    if (rails.length !== 1 || rails[0].network !== manifest.binding.network) return fail("assignment_ineligible");
  }
  function event(id: string): AssignmentEvent | null {
    const raw = db.prepare("SELECT request_id,input_digest,event FROM owner269_operations WHERE request_id=?").get(id);
    if (!raw) return null;
    if (typeof raw.event !== "string" || Buffer.byteLength(raw.event) > EVENT_BYTES) return fail();
    const parsed = eventSchema.parse(JSON.parse(raw.event));
    if (parsed.receipt.requestId !== id || parsed.inputDigest !== raw.input_digest || parsed.receipt.inputDigest !== raw.input_digest
      || parsed.input.requestId !== id || parsed.input.action !== parsed.receipt.action
      || parsed.inputDigest !== assignmentDigest("operation", { input: parsed.input, actor: parsed.actor })) return fail();
    binding(parsed.manifest); return parsed;
  }
  function association(id: string): Association {
    const raw = db.prepare("SELECT * FROM owner269_associations WHERE assignment_id=?").get(id);
    if (!raw || typeof raw.state !== "string" || Buffer.byteLength(raw.state) > 32_768) return fail("assignment_conflict");
    const row = associationSchema.parse(JSON.parse(raw.state));
    if (row.member.assignmentId !== raw.assignment_id || row.member.runId !== raw.run_id || row.revision !== raw.revision
      || row.status !== raw.status || row.applyId !== raw.apply_id || row.lastOperationId !== raw.last_operation_id
      || row.manifest.recipient.accountId !== raw.recipient_account || row.manifest.recipient.memberGeneration !== raw.recipient_generation
      || !same(row.member, row.manifest.members[row.ordinal])) return fail();
    binding(row.manifest); return row;
  }
  function consent(manifest: Manifest, consentId: string, now: number, pending: boolean) {
    const proof = event(consentId);
    if (!proof || proof.receipt.action !== "consent" || !same(proof.manifest, manifest) || !same(proof.actor, manifest.recipient)
      || proof.consentAt === null || proof.consentAt > now || pending && (manifest.admissionExpiresAt <= now
        || manifest.admissionExpiresAt > proof.consentAt + CONSENT_TTL_MS)) return fail("assignment_consent_required");
    const credential = known(manifest.recipient);
    if (credential.generation !== proof.credentialGeneration || db.prepare(`SELECT 1 FROM owner269_operations
      WHERE json_extract(event,'$.receipt.action')='withdraw-consent' AND json_extract(event,'$.consentId')=? LIMIT 1`).get(consentId))
      return fail("assignment_consent_required");
    return proof;
  }
  function replay(id: string, digest: string, trustedActor: AssignmentEvent["actor"]) {
    const previous = event(id);
    if (!previous) return null;
    // Receipt access is authorized FIRST by owner capability or current actor().
    if (previous.inputDigest !== digest || !same(previous.actor, trustedActor)) return fail("assignment_conflict");
    return previous.receipt;
  }
  function save(row: Association, previous?: Association) {
    const encoded = canonicalJson(associationSchema.parse(row));
    if (Buffer.byteLength(encoded) > 32_768) return fail();
    if (previous) {
      const result = db.prepare(`UPDATE owner269_associations SET revision=?,status=?,last_operation_id=?,state=?
        WHERE assignment_id=? AND revision=? AND status=?`).run(row.revision, row.status, row.lastOperationId, encoded,
        row.member.assignmentId, previous.revision, previous.status);
      if (result.changes !== 1) return fail("assignment_conflict");
    } else db.prepare("INSERT INTO owner269_associations VALUES(?,?,?,?,?,?,?,?,?)").run(row.member.assignmentId,
      row.member.runId, row.manifest.recipient.accountId, row.manifest.recipient.memberGeneration, row.revision, row.status,
      row.applyId, row.lastOperationId, encoded);
  }
  function append(value: AssignmentEvent) {
    const checked = eventSchema.parse(value), encoded = canonicalJson(checked);
    if (Buffer.byteLength(encoded) > EVENT_BYTES) return fail();
    if (checked.receipt.results.length !== checked.priorMembers.length
      || new Set(checked.receipt.results.map(r => r.assignmentId)).size !== checked.receipt.results.length
      || checked.receipt.results.some((r, i) => r.assignmentId !== checked.priorMembers[i].assignmentId)) return fail();
    db.prepare("INSERT INTO owner269_operations VALUES(?,?,?)").run(checked.receipt.requestId, checked.inputDigest, encoded);
    // Every operation result must have the exact matching row and audit link.
    for (const result of checked.receipt.results) {
      const row = association(result.assignmentId);
      if (row.lastOperationId !== checked.receipt.requestId || row.revision !== result.revision || row.status !== result.status) return fail();
    }
  }
  function receipt(input: { requestId: string; action: Receipt["action"] }, digest: string, now: number, rows: Association[]): Receipt {
    return receiptSchema.parse({ version: 1, requestId: input.requestId, inputDigest: digest, action: input.action, committedAt: now,
      results: rows.map(row => ({ assignmentId: row.member.assignmentId, revision: row.revision, status: row.status })),
      meaning: "historical-committed-result-not-current-authority" });
  }
  function arbitration() {
    // Missing joint #262/original writer scope is a hard hold, never a verified
    // boolean or a same-name trigger supplied by the caller. The complete native
    // source profile must also admit these exact guards before they can be used.
    const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();
    for (const expected of OWNER269_OCCUPANCY_PROPOSAL) {
      const actual = db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(expected.name);
      if (typeof actual?.sql !== "string" || normalize(actual.sql) !== normalize(expected.sql)) return fail("assignment_arbitration_unavailable");
    }
  }
  const port: NativeOwnerRunAssignments = {
    stage(raw, consentId) { return transaction(false, now => {
      const manifest = parseManifest(raw), holds: string[] = [];
      binding(manifest); known(manifest.recipient);
      for (const member of manifest.members) original(manifest, member, now);
      try { arbitration(); } catch (error) { if (!(error instanceof AssignmentError)) throw error; holds.push(error.code); }
      if (consentId) { try { consent(manifest, consentId, now, true); } catch (error) {
        if (!(error instanceof AssignmentError)) throw error; holds.push(error.code);
      } } else holds.push("assignment_consent_required");
      return { version: 1 as const, manifest, manifestDigest: assignmentDigest("manifest", manifest), applicable: holds.length === 0, holds };
    }); },
    owner(raw, authorization) {
      guard(true); const input = ownerActionSchema.parse(raw), ownerAuthorization = assertLocalOwner(authorization, input);
      return transaction(true, now => {
        assertLocalOwner(authorization, input);
        const trustedActor = { ownerId: "posix-uid:0" as const, ownerAuthorization }, digest = assignmentDigest("operation", { input, actor: trustedActor });
        const historical = replay(input.requestId, digest, trustedActor); if (historical) return historical;
        let manifest: Manifest, consentId: string, proof: AssignmentEvent, priorOperationId: string | null;
        const rows: Association[] = [], priorMembers: AssignmentEvent["priorMembers"] = [];
        if (input.action === "apply") {
          manifest = parseManifest(input.manifest); binding(manifest); known(manifest.recipient);
          proof = consent(manifest, input.consentId, now, true); consentId = input.consentId; priorOperationId = null;
          arbitration();
          const count = db.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM owner269_associations
            WHERE recipient_account=? AND recipient_generation=? AND status IN ('assigned-by-owner','claimed') LIMIT 26)`)
            .get(manifest.recipient.accountId, manifest.recipient.memberGeneration)?.n;
          if (typeof count !== "number" || count + manifest.members.length > 25) return fail("assignment_conflict");
          for (const [ordinal, member] of manifest.members.entries()) {
            original(manifest, member, now);
            if (db.prepare("SELECT 1 FROM owner269_associations WHERE assignment_id=? OR (run_id=? AND status IN ('assigned-by-owner','claimed')) LIMIT 1")
              .get(member.assignmentId, member.runId)) return fail("assignment_conflict");
            const row: Association = { version: 1, manifest, member, consentId, applyId: input.requestId, lastOperationId: input.requestId,
              ordinal, status: "assigned-by-owner", revision: 1, assignedAt: now, confirmedAt: null, decidedAt: null };
            priorMembers.push({ assignmentId: member.assignmentId, revision: null, status: null, priorOperationId: null });
            save(row); rows.push(row);
          }
        } else {
          const apply = event(input.applyId);
          if (!apply || apply.receipt.action !== "apply" || !apply.consentId) return fail("assignment_conflict");
          manifest = apply.manifest; consentId = apply.consentId; proof = event(consentId)!; priorOperationId = input.applyId;
          if (input.expected.length !== manifest.members.length || !same(input.expected.map(v => v.assignmentId), manifest.members.map(v => v.assignmentId)))
            return fail("assignment_conflict");
          for (const expected of input.expected) {
            const previous = association(expected.assignmentId);
            if (previous.applyId !== input.applyId || previous.revision !== expected.revision || !active(previous)) return fail("assignment_conflict");
            if (input.action === "cleanup") {
              let lineageInvalid = false; try { consent(manifest, consentId, now, previous.status === "assigned-by-owner"); }
              catch (error) { if (error instanceof AssignmentError && ["assignment_consent_required", "assignment_unauthenticated"].includes(error.code)) lineageInvalid = true; else throw error; }
              if (!lineageInvalid) return fail("assignment_conflict");
            }
            const row: Association = { ...previous, revision: previous.revision + 1, status: "revoked", lastOperationId: input.requestId, decidedAt: now };
            priorMembers.push({ assignmentId: previous.member.assignmentId, revision: previous.revision, status: previous.status, priorOperationId: previous.lastOperationId });
            save(row, previous); rows.push(row);
          }
        }
        const result = receipt(input, digest, now, rows);
        append({ version: 1, actor: trustedActor, input, priorMembers, credentialGeneration: null, inputDigest: digest, manifest,
          consentId, consentAt: proof.consentAt, priorOperationId, receipt: result });
        return result;
      });
    },
    lookupOwner(raw, authorization) {
      const input = ownerActionSchema.parse(raw), ownerAuthorization = assertLocalOwner(authorization, input);
      return transaction(false, () => {
        assertLocalOwner(authorization, input);
        const trustedActor = { ownerId: "posix-uid:0" as const, ownerAuthorization };
        const result = replay(input.requestId, assignmentDigest("operation", { input, actor: trustedActor }), trustedActor);
        return result ? { status: "committed" as const, receipt: result } : { status: "absent" as const };
      });
    },
    act(rawSession, rawExpected, rawInput, configuredOrigin) {
      guard(true); const expected = recipientSchema.parse(rawExpected), input = recipientActionSchema.parse(rawInput);
      return transaction(true, now => {
        const current = actor(rawSession, now);
        if (!same(current.recipient, expected) || current.origin !== configuredOrigin) return fail("assignment_conflict");
        const digest = assignmentDigest("operation", { input, actor: current.recipient });
        const historical = replay(input.requestId, digest, current.recipient); if (historical) return historical;
        let manifest: Manifest, consentId: string | null, consentAt: number | null, priorOperationId: string | null = null;
        const rows: Association[] = [], priorMembers: AssignmentEvent["priorMembers"] = [];
        if (input.action === "consent") {
          manifest = parseManifest(input.manifest); binding(manifest);
          if (!same(manifest.recipient, current.recipient) || manifest.binding.origin !== current.origin
            || manifest.admissionExpiresAt <= now || manifest.admissionExpiresAt > now + CONSENT_TTL_MS) return fail("assignment_consent_required");
          for (const member of manifest.members) original(manifest, member, now);
          consentId = input.requestId; consentAt = now;
        } else if (input.action === "withdraw-consent") {
          const proof = event(input.consentId);
          if (!proof || proof.receipt.action !== "consent" || !same(proof.actor, current.recipient)) return fail("assignment_conflict");
          manifest = proof.manifest; consentId = input.consentId; consentAt = proof.consentAt; priorOperationId = input.consentId;
          if (db.prepare("SELECT 1 FROM owner269_operations WHERE json_extract(event,'$.receipt.action')='withdraw-consent' AND json_extract(event,'$.consentId')=? LIMIT 1").get(consentId))
            return fail("assignment_conflict");
          const retained = manifest.members.map(m => {
            const exists = db.prepare("SELECT 1 FROM owner269_associations WHERE assignment_id=?").get(m.assignmentId);
            return exists ? association(m.assignmentId) : null;
          }).filter((v): v is Association => v !== null && v.consentId === consentId && active(v));
          if (!same(input.expected, retained.map(r => ({ assignmentId: r.member.assignmentId, revision: r.revision })))) return fail("assignment_conflict");
          for (const previous of retained) {
            const row: Association = { ...previous, status: "revoked", revision: previous.revision + 1, lastOperationId: input.requestId, decidedAt: now };
            priorMembers.push({ assignmentId: previous.member.assignmentId, revision: previous.revision, status: previous.status, priorOperationId: previous.lastOperationId });
            save(row, previous); rows.push(row);
          }
        } else {
          const previous = association(input.expected.assignmentId); manifest = previous.manifest;
          if (!same(manifest.recipient, current.recipient) || manifest.binding.origin !== current.origin
            || !active(previous) || previous.revision !== input.expected.revision) return fail("assignment_conflict");
          consentId = previous.consentId; consentAt = event(consentId)?.consentAt ?? null; priorOperationId = previous.lastOperationId;
          if (input.action === "confirm") {
            if (previous.status !== "assigned-by-owner") return fail("assignment_conflict");
            consent(manifest, consentId, now, true); original(manifest, previous.member, now);
          } else if (input.action === "reject" && previous.status !== "assigned-by-owner") return fail("assignment_conflict");
          // Negative decisions deliberately do not read run content or require
          // positive consent/expiry. actor() already proved the original generation.
          const row: Association = { ...previous, revision: previous.revision + 1, lastOperationId: input.requestId,
            status: input.action === "confirm" ? "claimed" : input.action === "reject" ? "rejected" : "revoked",
            confirmedAt: input.action === "confirm" ? now : previous.confirmedAt, decidedAt: now };
          priorMembers.push({ assignmentId: previous.member.assignmentId, revision: previous.revision, status: previous.status, priorOperationId: previous.lastOperationId });
          save(row, previous); rows.push(row);
        }
        const result = receipt(input, digest, now, rows);
        append({ version: 1, actor: current.recipient, input, priorMembers, credentialGeneration: current.credentialGeneration,
          inputDigest: digest, manifest, consentId, consentAt, priorOperationId, receipt: result });
        return result;
      });
    },
    reply(rawSession, expectedWallet, configuredOrigin, expected, rawReceipt) {
      return transaction(false, now => {
        const current = actor(rawSession, now);
        if (current.recipient.wallet !== expectedWallet || current.origin !== configuredOrigin
          || expected && !same(current.recipient, expected)) return fail("assignment_conflict");
        if (rawReceipt) {
          const prior = event(receiptSchema.parse(rawReceipt).requestId);
          if (!prior || !same(prior.actor, current.recipient) || !same(prior.receipt, rawReceipt)) return fail("assignment_unauthenticated");
        }
        const ids = db.prepare(`SELECT assignment_id FROM owner269_associations WHERE recipient_account=? AND recipient_generation=?
          AND status IN ('assigned-by-owner','claimed') ORDER BY assignment_id LIMIT 26`).all(current.recipient.accountId, current.recipient.memberGeneration);
        if (ids.length > 25) return fail();
        const history = ids.map(id => {
          const row = association(id.assignment_id as string); let effective = true;
          if (!same(row.manifest.recipient, current.recipient) || row.manifest.binding.origin !== current.origin) return fail();
          try { consent(row.manifest, row.consentId, now, row.status === "assigned-by-owner"); original(row.manifest, row.member, now); }
          catch (error) {
            if (error instanceof AssignmentError && ["assignment_consent_required", "assignment_unauthenticated", "assignment_ineligible"].includes(error.code)) effective = false;
            else throw error;
          }
          return projectAssignment(row, effective);
        });
        // Serialize now, under the same read transaction; no await follows this
        // transaction, its COMMIT, or the final genuine connection guard.
        return Response.json({ version: 1, kind: "owner-assignment-inbox", recipient: current.recipient, history,
          profile: { assignedByOwner: history.filter(r => r.effective && r.attribution === "assigned-by-owner").length,
            claimedFromOwnerAssignment: history.filter(r => r.effective && r.attribution === "claimed-from-owner-assignment").length },
          ...(rawReceipt ? { receipt: rawReceipt } : {}) }, { headers });
      });
    },
  };
  return Object.freeze(port);
}
