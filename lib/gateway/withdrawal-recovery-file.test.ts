import { expect, it } from "vitest";
import { creatorWithdrawalFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { parseWithdrawalRecoveryFile } from "./withdrawal-recovery-file";

it("binds a bounded recovery-only file to the original signature, network and owner", async () => {
  const { record } = await creatorWithdrawalFixture();
  const file = { format: "keryx-withdrawal-recovery-v1", network: "eip155:5042002", recoveryOnly: true,
    exportedAt: new Date().toISOString(), original: record };
  expect(await parseWithdrawalRecoveryFile(JSON.stringify(file), record.owner)).toEqual(record);
  for (const delta of [{ recoveryOnly: false }, { network: "eip155:1" }, { format: "unknown" }, { submitted: false }])
    await expect(parseWithdrawalRecoveryFile(JSON.stringify({ ...file, ...delta }), record.owner)).rejects.toThrow();
  await expect(parseWithdrawalRecoveryFile(JSON.stringify(file), `0x${"00".repeat(20)}`)).rejects.toThrow("owner mismatch");
  record.request.burnIntent.spec.value = "1";
  await expect(parseWithdrawalRecoveryFile(JSON.stringify(file), record.owner)).rejects.toThrow();
});

it("rejects oversized UTF-8 input and malformed files before interpreting authorization", async () => {
  const owner = `0x${"00".repeat(20)}`;
  for (const text of ["x".repeat(16385), "é".repeat(8200), "{", "null"])
    await expect(parseWithdrawalRecoveryFile(text, owner)).rejects.toThrow();
});
