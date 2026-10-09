import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readAcceptanceInputFile } from "./input-file";
it("CLI accepts one bounded closed UTF-8 submission and refuses nonregular, oversized or invalid inputs without echoing private contents", () => {
  const directory = mkdtempSync(join(tmpdir(), "keryx-acceptance-input-")), file = join(directory, "submission.json");
  const input = { originalFingerprint: "1".repeat(64), deliveredDigest: "2".repeat(64), expectedRevision: 0,
    idempotencyKey: "synthetic-cli-request-0001", choice: "accept", reason: "Private synthetic reason 😀", publishState: false };
  try {
    writeFileSync(file, JSON.stringify(input)); expect(readAcceptanceInputFile(file)).toEqual(input);
    expect(() => readAcceptanceInputFile(directory)).toThrow("regular UTF-8 JSON file");
    for (const bytes of [Buffer.alloc(16385, 0x20), Buffer.from([0xff]), Buffer.from(JSON.stringify({ ...input, owner: "caller-chosen" }))]) {
      writeFileSync(file, bytes);
      try { readAcceptanceInputFile(file); throw Error("Unexpected success"); } catch (error) {
        expect(String(error)).toContain("regular UTF-8 JSON file"); expect(String(error)).not.toMatch(/Private synthetic|caller-chosen|submission\.json/);
      }
    }
  } finally { unlinkSync(file); rmdirSync(directory); }
});
