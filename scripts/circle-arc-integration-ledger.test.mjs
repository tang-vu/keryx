import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkRepositoryLedger, validateLedger } from "./circle-arc-integration-ledger.mjs";

const fixture = () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-ledger-test-"));
  fs.mkdirSync(path.join(repoRoot, "docs/engineering"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "lib"));
  fs.writeFileSync(path.join(repoRoot, "lib/example.ts"), "// fixture, no application loading\n");
  const documentPath = path.join(repoRoot, "docs/engineering/ledger.md");
  fs.writeFileSync(documentPath, "");
  const table = (code = "[adapter](../../lib/example.ts)", status = "Live", proof = "[exact record](https://example.test/receipt/123)", tracking = "[#304](https://github.com/tang-vu/keryx/issues/304)") =>
    `<!-- circle-arc-ledger:start -->\n| Tool | What Keryx uses it for | Code | Network | Status | Proof | Tracking |\n| --- | --- | --- | --- | --- | --- | --- |\n| Gateway | Read a balance | ${code} | Arc mainnet | ${status} | ${proof} | ${tracking} |\n<!-- circle-arc-ledger:end -->`;
  return { table, check: markdown => validateLedger(markdown, { repoRoot, documentPath }),
    clean: () => fs.rmSync(repoRoot, { recursive: true, force: true }) };
};

test("the real repository ledger references existing files", () => {
  const result = checkRepositoryLedger();
  assert.ok(result.rows > 0);
  assert.ok(result.checkedPaths > 0);
});

test("removed files and unvalidated paths fail; explicit exclusions pass", () => {
  const f = fixture();
  try {
    assert.deepEqual(f.check(f.table()), { rows: 1, checkedPaths: 1 });
    assert.deepEqual(f.check(f.table("—", "Not used", "No integration claimed")), { rows: 1, checkedPaths: 0 });
    assert.throws(() => f.check(f.table("[removed](../../lib/removed.ts)")), /Code file missing/);
    assert.throws(() => f.check(f.table("[directory](../../lib)")), /Code file missing/);
    assert.throws(() => f.check(f.table("../../lib/example.ts")), /Code links missing/);
    assert.throws(() => f.check(f.table("[adapter](../../lib/example.ts), lib/untracked.ts")), /Unvalidated code text/);
  } finally { f.clean(); }
});

test("code paths cannot escape the checkout or point at a public URL", () => {
  const f = fixture();
  try {
    assert.throws(() => f.check(f.table("[outside](../../../outside.ts)")), /escapes repository/);
    assert.throws(() => f.check(f.table("[vendor](https://example.test/source.ts)")), /Invalid local code path/);
  } finally { f.clean(); }
});

test("Live claims require HTTPS proof and every row needs a tracking issue", () => {
  const f = fixture();
  try {
    assert.throws(() => f.check(f.table(undefined, "Live", "Pending")), /proof missing/);
    assert.throws(() => f.check(f.table(undefined, "Live", "[local](../../lib/example.ts)")), /proof missing/);
    assert.throws(() => f.check(f.table(undefined, "Live", undefined, "Pending")), /Tracking issue missing/);
    assert.throws(() => f.check(f.table(undefined, "Maybe live")), /Invalid status/);
  } finally { f.clean(); }
});

test("malformed inventory fails instead of silently skipping rows", () => {
  const f = fixture();
  try {
    assert.throws(() => f.check(f.table().replace("| Gateway |", "| Gateway | unexpected |")), /seven columns/);
    assert.throws(() => f.check(f.table().replace("| Gateway | Read a balance", "Gateway | Read a balance")), /Malformed/);
    assert.throws(() => f.check(`${f.table()}\n<!-- circle-arc-ledger:start -->`), /exactly one/);
    assert.throws(() => f.check(f.table().replace("| Tool |", "| Product |")), /header/);
  } finally { f.clean(); }
});

test("all local document links and exact Markdown/source anchors are checked", () => {
  const f = fixture();
  try {
    assert.doesNotThrow(() => f.check(`${f.table()}\n## Proof gate\n## Proof gate\n<a id="exact-id"></a>\n[gate](#proof-gate) [duplicate](#proof-gate-1) [explicit](#exact-id) [line](../../lib/example.ts#L1)`));
    assert.throws(() => f.check(`${f.table()}\n[missing](#unknown-heading)`), /Markdown anchor missing/);
    assert.throws(() => f.check(`${f.table()}\n[removed](../../docs/removed.md)`), /Code file missing/);
    assert.throws(() => f.check(`${f.table()}\n[bad line](../../lib/example.ts#L999)`), /Source line anchor missing/);
    assert.throws(() => f.check(`${f.table()}\n\x60\x60\x60md\n## Not a heading\n\x60\x60\x60\n[fenced](#not-a-heading)`), /Markdown anchor missing/);
  } finally { f.clean(); }
});
