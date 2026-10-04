import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { BrowserSessionAuthorizationBinding } from "../../lib/session/browser-session-runtime";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../lib/canonical-json";
import { ARC_MAINNET_PROFILE } from "../../lib/arc-network-profile";
import { browserSessionCustodyContext, type BrowserSessionCustodyContext } from "../../lib/session/browser-session-custody";
import type { RetainedSessionStore } from "../../lib/session/browser-session-key";
import type { IsolatedWrappedKey, WrappingKeyStore } from "../../lib/session/isolated-session-vault";
import { HEADLESS_WITHDRAWAL_SCHEMA, HEADLESS_WITHDRAWAL_V4_SCHEMA, headlessWithdrawalStorage } from "./headless-mainnet-withdrawals.mjs";
import { HEADLESS_FAILURE_SCHEMA, recordHeadlessFailure } from "./headless-mainnet-failures.mjs";
import type { BrowserSessionFailedAuthorization } from "../../lib/session/browser-session-withdrawal-liabilities";

const ERROR = "Headless session state unavailable; preserve custody and original attempts for owner recovery";
const fail = (): never => { throw new Error(ERROR); };
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ORIGINALS = 10000;
const WINDOWS_ACL = `
$ErrorActionPreference='Stop';
$i=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
$a=Get-Acl -LiteralPath $env:KERYX_HEADLESS_ACL_TARGET;
$r=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | Where-Object {$_.AccessControlType -eq 'Allow'});
$o=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;
$bad=@($r | Where-Object {$_.IdentityReference.Value -notin @($i,'S-1-5-18','S-1-5-32-544')});
@{ownerMatches=($o -eq $i);protected=$a.AreAccessRulesProtected;private=($bad.Count -eq 0);rules=$r.Count} | ConvertTo-Json -Compress`;
function protectedPath(target: string, directory: boolean) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES)) fail();
  const real = fs.realpathSync(target), resolved = path.resolve(target);
  if (process.platform === "win32" ? real.toLowerCase() !== resolved.toLowerCase() : real !== resolved) fail();
  if (process.platform === "win32") {
    const proof = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_ACL], {
      windowsHide: true, timeout: 5000, maxBuffer: 16384, encoding: "utf8",
      env: { ...process.env, KERYX_HEADLESS_ACL_TARGET: target },
    }));
    if (!proof.ownerMatches || !proof.protected || !proof.private || proof.rules < 1) fail();
  } else if (typeof process.getuid !== "function" || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) fail();
  return stat;
}
function syncDirectory(directory: string) {
  // Windows visibility and flush are checked by native acceptance; durable namespace
  // publication across host power loss remains a separate host/filesystem gate.
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
function blob(value: unknown, context: BrowserSessionCustodyContext): IsolatedWrappedKey {
  if (!value || typeof value !== "object") fail();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(",") !== "address,contextDigest,format,iv,wrapped" ||
    v.format !== "keryx-isolated-session-v2" || v.contextDigest !== context.digest ||
    typeof v.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v.address) ||
    typeof v.iv !== "string" || !/^[0-9a-f]{24}$/.test(v.iv) ||
    typeof v.wrapped !== "string" || !/^[0-9a-f]{164}$/.test(v.wrapped)) fail();
  return { format: "keryx-isolated-session-v2", contextDigest: context.digest, address: v.address as `0x${string}`,
    iv: Uint8Array.from(Buffer.from(v.iv as string, "hex")), wrapped: Uint8Array.from(Buffer.from(v.wrapped as string, "hex")) };
}

/** Owner-only standalone storage. Keys come from protected environment, never from
 * this database. It retains the first ciphertext and every admitted nonce forever;
 * local locks/exposure are not a distributed clone-proof or server settlement ledger. */
export async function openHeadlessMainnetState(directory: string, context: BrowserSessionCustodyContext, wrappingKey: string, createIfMissing = true, migrateLegacy = false) {
  let database: DatabaseSync | undefined, lock: string | undefined, lockInode: fs.Stats | undefined;
  try {
    if (!path.isAbsolute(directory) || path.resolve(directory) !== directory || context.profile !== ARC_MAINNET_PROFILE ||
      !/^0x[0-9a-fA-F]{64}$/.test(wrappingKey) ||
      canonicalJson(context) !== canonicalJson(browserSessionCustodyContext(ARC_MAINNET_PROFILE, context.origin, context.owner))) fail();
    protectedPath(directory, true);
    lock = path.join(directory, `${context.storageNamespace}.lock`);
    fs.mkdirSync(lock, { mode: 0o700 }); lockInode = fs.lstatSync(lock); syncDirectory(directory);
    const file = path.join(directory, `${context.storageNamespace}.sqlite`);
    let fresh = false;
    try { protectedPath(file, false); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !createIfMissing) throw error;
      const descriptor = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0), 0o600);
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      fresh = true; syncDirectory(directory);
    }
    // Existing protected Windows parent supplies owner-only inheritance to a fresh
    // file; require the file's effective rules, without demanding protected inheritance.
    if (fresh && process.platform === "win32") {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop';$a=Get-Acl -LiteralPath $env:KERYX_HEADLESS_ACL_TARGET;$a.SetAccessRuleProtection($true,$true);Set-Acl -LiteralPath $env:KERYX_HEADLESS_ACL_TARGET -AclObject $a`],
        { windowsHide: true, timeout: 5000, maxBuffer: 16384, env: { ...process.env, KERYX_HEADLESS_ACL_TARGET: file } });
    }
    protectedPath(file, false);
    database = new DatabaseSync(file);
    if (fresh) database.exec("PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=1000;");
    const identity = canonicalJson({ format: "keryx-headless-session-state-v4", custody: context });
    const v2Identity = canonicalJson({ format: "keryx-headless-session-state-v2", custody: context });
    const v3Identity = canonicalJson({ format: "keryx-headless-session-state-v3", custody: context });
    if (fresh) {
      database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),value TEXT NOT NULL) STRICT;
        CREATE TABLE custody(singleton INTEGER PRIMARY KEY CHECK(singleton=1),value TEXT NOT NULL) STRICT;
        CREATE TABLE questions(id TEXT PRIMARY KEY,budget TEXT NOT NULL) STRICT;
        CREATE TRIGGER questions_no_update BEFORE UPDATE ON questions BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER questions_no_delete BEFORE DELETE ON questions BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TABLE exposure(nonce TEXT PRIMARY KEY,epoch TEXT NOT NULL,amount TEXT NOT NULL,cap TEXT NOT NULL,req_id TEXT,question_id TEXT NOT NULL REFERENCES questions(id),original TEXT NOT NULL CHECK(json_valid(original)),requirements_digest TEXT NOT NULL) STRICT;
        CREATE TABLE headers(nonce TEXT PRIMARY KEY REFERENCES exposure(nonce),value TEXT NOT NULL) STRICT;
        CREATE TABLE terminal(nonce TEXT PRIMARY KEY REFERENCES exposure(nonce),proof_digest TEXT NOT NULL) STRICT;
        CREATE TRIGGER terminal_no_update BEFORE UPDATE ON terminal BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER terminal_no_delete BEFORE DELETE ON terminal BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER identity_no_update BEFORE UPDATE ON identity BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER identity_no_delete BEFORE DELETE ON identity BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER custody_no_update BEFORE UPDATE ON custody BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER custody_no_delete BEFORE DELETE ON custody BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER exposure_no_update BEFORE UPDATE ON exposure BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER exposure_no_delete BEFORE DELETE ON exposure BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER headers_no_update BEFORE UPDATE ON headers BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER headers_no_delete BEFORE DELETE ON headers BEGIN SELECT RAISE(ABORT,'immutable'); END;`);
      database.exec(HEADLESS_WITHDRAWAL_SCHEMA);
      database.exec(HEADLESS_WITHDRAWAL_V4_SCHEMA + HEADLESS_FAILURE_SCHEMA);
      database.prepare("INSERT INTO identity VALUES(1,?)").run(identity); database.exec("COMMIT"); syncDirectory(directory);
    }
    const db = database;
    const previousIdentity = db.prepare("SELECT value FROM identity WHERE singleton=1").get()?.value;
    if (!fresh && (previousIdentity === v2Identity || previousIdentity === v3Identity)) {
      if (!migrateLegacy || db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") fail();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
      const expectedTables = ["custody","exposure","headers","identity","questions","terminal",
        ...(previousIdentity === v3Identity ? ["upgrade_history","withdrawals"] : [])];
      if (canonicalJson(tables) !== canonicalJson(expectedTables)) fail();
      db.exec("PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE");
      try {
        if (db.prepare("SELECT value FROM identity WHERE singleton=1").get()?.value !== previousIdentity) fail();
        if (previousIdentity === v2Identity) {
          db.exec(HEADLESS_WITHDRAWAL_SCHEMA);
          db.prepare("INSERT INTO upgrade_history VALUES(1,?)").run(previousIdentity);
        }
        db.exec(HEADLESS_WITHDRAWAL_V4_SCHEMA + HEADLESS_FAILURE_SCHEMA);
        db.prepare("INSERT INTO upgrade_v4_history VALUES(1,?)").run(previousIdentity);
        db.exec("DROP TRIGGER identity_no_update");
        db.prepare("UPDATE identity SET value=? WHERE singleton=1").run(identity);
        db.exec("CREATE TRIGGER identity_no_update BEFORE UPDATE ON identity BEGIN SELECT RAISE(ABORT,'immutable'); END; COMMIT");
        syncDirectory(directory);
      } catch { try { db.exec("ROLLBACK"); } catch { /* Preserve original database. */ } fail(); }
    }
    if (db.prepare("SELECT value FROM identity WHERE singleton=1").get()?.value !== identity ||
      db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") fail();
    db.exec("PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=1000;");
    const bytes = Uint8Array.from(Buffer.from(wrappingKey.slice(2), "hex"));
    let aes: CryptoKey;
    try { aes = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
    finally { bytes.fill(0); }
    let closed = false;
    const active = () => { if (closed || db.prepare("SELECT value FROM identity WHERE singleton=1").get()?.value !== identity) fail(); };
    const withdrawals = headlessWithdrawalStorage(db, context, active, () => syncDirectory(directory), aes);
    const wrappingKeys: WrappingKeyStore = { async getOrCreate(namespace) {
      active(); if (namespace !== context.storageNamespace) fail(); return aes;
    }, async destroy() { fail(); } };
    const retained: RetainedSessionStore = {
      async read(namespace) {
        active(); if (namespace !== context.storageNamespace) fail();
        const row = db.prepare("SELECT value FROM custody WHERE singleton=1").get();
        return row ? blob(JSON.parse(String(row.value)), context) : null;
      },
      async retain(namespace, candidate) {
        active(); if (namespace !== context.storageNamespace) fail();
        const serialized = canonicalJson({ ...candidate, iv: Buffer.from(candidate.iv).toString("hex"), wrapped: Buffer.from(candidate.wrapped).toString("hex") });
        blob(JSON.parse(serialized), context);
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare("INSERT OR IGNORE INTO custody VALUES(1,?)").run(serialized);
          const original = blob(JSON.parse(String(db.prepare("SELECT value FROM custody WHERE singleton=1").get()!.value)), context);
          db.exec("COMMIT"); syncDirectory(directory); return original;
        } catch { try { db.exec("ROLLBACK"); } catch { /* committed exposure stays held */ } return fail(); }
      },
    };
    return Object.freeze({ wrappingKeys, retained, file, withdrawals,
      async reserve(namespace: string, epoch: string, nonce: string, amount: bigint, cap: bigint, question: {id:string;budgetMicroUsdc:string}, original: BrowserSessionAuthorizationBinding) {
        active(); if (namespace !== context.storageNamespace || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(epoch) || !/^0x[0-9a-f]{64}$/.test(nonce) ||
          (!original || original.sessionId !== context.owner || original.grantEpoch !== epoch || original.expectedNonce !== nonce ||
            !/^0x[0-9a-f]{40}$/.test(original.sessAddr) || original.sessAddr === context.owner ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(original.reqId) ||
            original.requirements.network !== context.profile.networkId || original.requirements.amount !== String(amount) ||
            original.requirements.asset !== context.profile.usdcAddress.toLowerCase() ||
            original.requirements.extra.verifyingContract !== context.profile.gatewayWallet.toLowerCase() ||
            !/^0x[0-9a-f]{40}$/.test(original.requirements.payTo)) ||
          !question || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(question.id) ||
          !/^[1-9]\d{0,15}$/.test(question.budgetMicroUsdc) || BigInt(question.budgetMicroUsdc)>BigInt(Number.MAX_SAFE_INTEGER) ||
          amount <= BigInt(0) || cap <= BigInt(0) || cap > BigInt(Number.MAX_SAFE_INTEGER)) fail();
        db.exec("BEGIN IMMEDIATE");
        try {
          if (withdrawals.activeWithdrawal()) fail();
          const priorQuestion=db.prepare("SELECT budget FROM questions WHERE id=?").get(question.id);
          if(priorQuestion && priorQuestion.budget!==question.budgetMicroUsdc)fail();
          db.prepare("INSERT OR IGNORE INTO questions VALUES(?,?)").run(question.id,question.budgetMicroUsdc);
          const rows = db.prepare("SELECT e.amount,e.question_id,f.nonce AS failed FROM exposure e LEFT JOIN failed_terminal f ON f.nonce=e.nonce").all();
          if (rows.length >= MAX_ORIGINALS) fail();
          let total = BigInt(0),questionTotal=BigInt(0);
          for (const row of rows) { if (!/^[1-9]\d{0,15}$/.test(String(row.amount))) fail();
            if(!row.failed)total += BigInt(String(row.amount));
            // Failed payment capacity may fund a new question; the original question
            // keeps its conservative lifetime allocation and cannot loop on failures.
            if(row.question_id===question.id)questionTotal+=BigInt(String(row.amount)); }
          if (total + amount > cap || questionTotal+amount>BigInt(question.budgetMicroUsdc)) fail();
          const binding = canonicalJson(original), digest = createHash("sha256").update(canonicalJson(original.requirements)).digest("hex");
          if(Buffer.byteLength(binding)>32768)fail();
          db.prepare("INSERT INTO exposure VALUES(?,?,?,?,?,?,?,?)").run(nonce, epoch, String(amount), String(cap), original.reqId, question.id, binding, digest);
          db.exec("COMMIT"); syncDirectory(directory);
        } catch { try { db.exec("ROLLBACK"); } catch { /* committed exposure stays held */ } return fail(); }
      },
      originalNonces() { active(); return db.prepare("SELECT nonce,epoch,amount,cap,req_id,original,requirements_digest FROM exposure ORDER BY nonce").all(); },
      unresolvedNonces() { active(); return db.prepare("SELECT nonce,epoch,amount,cap,req_id,original,requirements_digest FROM exposure WHERE nonce NOT IN (SELECT nonce FROM terminal) AND nonce NOT IN (SELECT nonce FROM failed_terminal) ORDER BY nonce").all(); },
      recordFailed(value: BrowserSessionFailedAuthorization) {
        active(); db.exec("BEGIN IMMEDIATE");
        try { active(); const changed=recordHeadlessFailure(db,structuredClone(value)); db.exec("COMMIT");syncDirectory(directory);return changed; }
        catch { try { db.exec("ROLLBACK"); } catch { /* Retain committed original failure evidence. */ } return fail(); }
      },
      recordSettled(nonce: string, proofDigest: string) {
        active(); if (!/^0x[0-9a-f]{64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(proofDigest) ||
          !db.prepare("SELECT nonce FROM exposure WHERE nonce=?").get(nonce)) fail();
        const existing=db.prepare("SELECT proof_digest FROM terminal WHERE nonce=?").get(nonce);
        if (existing && existing.proof_digest!==proofDigest) fail();
        db.prepare("INSERT OR IGNORE INTO terminal VALUES(?,?)").run(nonce,proofDigest);syncDirectory(directory);
      },
      async retainHeader(nonce: string, paymentHeader: string) {
        active(); if (!/^0x[0-9a-f]{64}$/.test(nonce) || paymentHeader.length < 1 || paymentHeader.length > 8192 ||
          !db.prepare("SELECT nonce FROM exposure WHERE nonce=?").get(nonce)) fail();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv,
          additionalData: new TextEncoder().encode(`${context.digest}\n${nonce}`) }, aes, new TextEncoder().encode(paymentHeader));
        active();
        db.prepare("INSERT INTO headers VALUES(?,?)").run(nonce, JSON.stringify({ iv: Buffer.from(iv).toString("hex"), encrypted: Buffer.from(encrypted).toString("hex") }));
        syncDirectory(directory);
      },
      close() {
        if (closed) return; closed = true; db.close(); database = undefined;
        const now = fs.lstatSync(lock!);
        if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== lockInode!.dev || now.ino !== lockInode!.ino) fail();
        fs.rmdirSync(lock!); lock = undefined; syncDirectory(directory);
      },
    });
  } catch {
    try { database?.close(); } catch { /* retain any original file */ }
    if (lock && lockInode) {
      try { const now = fs.lstatSync(lock); if (now.isDirectory() && !now.isSymbolicLink() && now.dev === lockInode.dev && now.ino === lockInode.ino) fs.rmdirSync(lock); } catch { /* retain uncertain lock */ }
    }
    return fail();
  }
}
