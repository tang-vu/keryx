import { expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from "viem";
import { creatorMintFixture } from "../../scripts/test-fixtures/creator-withdrawal";
import { matchWithdrawalAttestation } from "./withdrawal-attestation";
import { matchWithdrawalMintReceipt, WITHDRAWAL_MINT_EVENT } from "./withdrawal-mint-receipt";

async function fixture() {
  const f = await creatorMintFixture(), matched = await matchWithdrawalAttestation(f.record, f.response);
  const spec = f.record.request.burnIntent.spec;
  const identity = { transactionHash: keccak256(f.raw), blockHash: `0x${"ab".repeat(32)}` as Hex,
    blockNumber: BigInt(9999), transactionIndex: 2 };
  const log = { ...identity, address: f.record.policy.gatewayMinter, removed: false, logIndex: 4,
    topics: encodeEventTopics({ abi: WITHDRAWAL_MINT_EVENT, eventName: "AttestationUsed", args: {
      token: f.record.policy.asset, recipient: f.record.policy.recipient, transferSpecHash: matched.transferSpecHash,
    } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
      [spec.sourceDomain, spec.sourceDepositor, spec.sourceSigner, BigInt(spec.value)]),
  };
  const receipt = { ...identity, from: f.terms.relayer, to: f.record.policy.gatewayMinter,
    status: "success", gasUsed: BigInt(150000), effectiveGasPrice: BigInt(1500000000), logs: [log] };
  return { ...f, receipt, run: () => matchWithdrawalMintReceipt(f.record, f.response, f.raw, f.terms, receipt) };
}

it("matches exact signed transaction and canonical minter event without claiming finality", async () => {
  const f = await fixture();
  expect(await f.run()).toMatchObject({ status: "mint-receipt-matched", authority: "receipt-matched-only",
    requestId: f.record.id, transactionHash: keccak256(f.raw), amountMicros: "50000",
    gasCostWei: "225000000000000", logIndex: 4, chainFinalityVerified: false });
});

it("refuses changed transaction, sender, destination, status or gas accounting", async () => {
  for (const changes of [{ transactionHash: `0x${"cc".repeat(32)}` }, { from: `0x${"cc".repeat(20)}` },
    { to: `0x${"cc".repeat(20)}` }, { status: "reverted" }, { gasUsed: BigInt(300001) },
    { gasUsed: BigInt(0) }, { effectiveGasPrice: BigInt(2000000001) }, { effectiveGasPrice: BigInt(-1) }]) {
    const f = await fixture(); Object.assign(f.receipt, changes);
    await expect(f.run()).rejects.toThrow("unavailable");
  }
});

it("refuses missing, duplicated or wrong-emitter mint events", async () => {
  const missing = await fixture(); missing.receipt.logs = [];
  await expect(missing.run()).rejects.toThrow("unavailable");
  const duplicate = await fixture(); duplicate.receipt.logs.push({ ...duplicate.receipt.logs[0], logIndex: 5 });
  await expect(duplicate.run()).rejects.toThrow("unavailable");
  const foreign = await fixture(); foreign.receipt.logs[0].address = `0x${"cc".repeat(20)}`;
  await expect(foreign.run()).rejects.toThrow("unavailable");
});

it("checks all indexed and unindexed event fields, including canonical address/domain padding", async () => {
  for (let index = 1; index < 4; index++) {
    const f = await fixture(); f.receipt.logs[0].topics[index] = `0x${"cd".repeat(32)}`;
    await expect(f.run()).rejects.toThrow("unavailable");
  }
  for (const byte of [0, 31, 32, 64, 96, 127]) {
    const f = await fixture(), log = f.receipt.logs[0];
    const start = 2 + byte * 2;
    log.data = `${log.data.slice(0, start)}ff${log.data.slice(start + 2)}` as Hex;
    await expect(f.run()).rejects.toThrow("unavailable");
  }
});

it("checks log block/transaction identity, indexes, removal and exact byte lengths", async () => {
  for (const changes of [{ blockHash: `0x${"cd".repeat(32)}` }, { transactionHash: `0x${"cd".repeat(32)}` },
    { blockNumber: BigInt(9998) }, { transactionIndex: 1 }, { logIndex: -1 }, { removed: true }, { data: "0x" }]) {
    const f = await fixture(); Object.assign(f.receipt.logs[0], changes);
    await expect(f.run()).rejects.toThrow("unavailable");
  }
});

it("permits unrelated well-formed logs but refuses duplicate log indexes", async () => {
  const f = await fixture();
  f.receipt.logs.push({ ...f.receipt.logs[0], address: `0x${"cc".repeat(20)}`, logIndex: 5, topics: [], data: "0x" });
  expect(await f.run()).toMatchObject({ status: "mint-receipt-matched" });
  f.receipt.logs[1].logIndex = 4;
  await expect(f.run()).rejects.toThrow("unavailable");
});

it("snapshots receipt, request and terms before asynchronous signature verification", async () => {
  const f = await fixture(), pending = f.run();
  f.receipt.logs[0].data = "0x"; f.record.request.burnIntent.spec.value = "1"; f.terms.nonce = 1;
  expect(await pending).toMatchObject({ amountMicros: "50000" });
});

it("accepts the expiration height itself but rejects a success receipt after that height", async () => {
  const f = await fixture();
  f.receipt.blockNumber = f.receipt.logs[0].blockNumber = BigInt(10000);
  expect(await f.run()).toMatchObject({ blockNumber: "10000" });
  f.receipt.blockNumber = f.receipt.logs[0].blockNumber = BigInt(10001);
  await expect(f.run()).rejects.toThrow("unavailable");
});
