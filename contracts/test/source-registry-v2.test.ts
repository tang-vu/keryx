import { expect } from "chai";
import { ethers } from "hardhat";
import type { SourceRegistryV2 } from "../../typechain-types";

describe("SourceRegistryV2 candidate (local only)", () => {
  async function fixture() {
    const [creator, other, payout] = await ethers.getSigners();
    const contract = await (await ethers.getContractFactory("SourceRegistryV2")).deploy() as SourceRegistryV2;
    const urlHash = ethers.keccak256(ethers.toUtf8Bytes("https://synthetic.invalid/feed"));
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [creator.address, urlHash]));
    await contract.register(urlHash, payout.address, [{ wallet: other.address, basisPoints: 10000 }], 2000, "cid", "research");
    return { contract, creator, other, payout, urlHash, id };
  }

  it("exposes an atomic record/revision snapshot and retains source identity", async () => {
    const { contract, creator, payout, id } = await fixture();
    expect(await contract.registryVersion()).to.equal(2);
    const state = await contract.getWithRevision(id);
    expect(state.revision).to.equal(1); expect(state.record.creator).to.equal(creator.address);
    expect(state.record.payoutWallet).to.equal(payout.address);
    expect(await contract.sourceIds(0)).to.equal(id);
  });

  it("rejects a price action signed before a payout change, preserving the new state", async () => {
    const { contract, creator, payout, id } = await fixture();
    await contract.update(id, 1, creator.address, [{ wallet: creator.address, basisPoints: 10000 }], 2000, "new-cid", "new-tags");
    await expect(contract.updatePrice(id, 1, 3000)).to.be.revertedWithCustomError(contract, "StaleRevision").withArgs(1, 2);
    const state = await contract.getWithRevision(id);
    expect(state.record.payoutWallet).not.to.equal(payout.address);
    expect(state.record.payoutWallet).to.equal(creator.address);
    expect(state.record.contentCid).to.equal("new-cid"); expect(state.record.fetchPriceUsdc6).to.equal(2000);
    expect(state.revision).to.equal(2);
  });

  it("changes only price after a deliberate refresh, preserving every other field", async () => {
    const { contract, id } = await fixture();
    const before = (await contract.getWithRevision(id)).record;
    await expect(contract.updatePrice(id, 1, 3000)).to.emit(contract, "SourceUpdated");
    const after = (await contract.getWithRevision(id)).record;
    expect(after.fetchPriceUsdc6).to.equal(3000);
    for (const key of ["creator", "payoutWallet", "authors", "contentCid", "tags", "active"] as const) expect(after[key]).to.deep.equal(before[key]);
    expect(await contract.revisions(id)).to.equal(2);
  });

  it("rejects stale full-record updates and delists after a competing price update", async () => {
    const { contract, payout, id } = await fixture();
    await contract.updatePrice(id, 1, 3000);
    await expect(contract.update(id, 1, payout.address, [], 1000, "old", "old")).to.be.revertedWithCustomError(contract, "StaleRevision");
    await expect(contract.deactivate(id, 1)).to.be.revertedWithCustomError(contract, "StaleRevision");
    expect((await contract.get(id)).active).to.equal(true);
    expect((await contract.get(id)).fetchPriceUsdc6).to.equal(3000);
    expect(await contract.revisions(id)).to.equal(2);
  });

  it("rejects ABA snapshots even when the price returns to its original value", async () => {
    const { contract, id } = await fixture();
    await contract.updatePrice(id, 1, 3000); await contract.updatePrice(id, 2, 2000);
    await expect(contract.updatePrice(id, 1, 4000)).to.be.revertedWithCustomError(contract, "StaleRevision").withArgs(1, 3);
  });

  it("accepts only one of two queued transactions using the same revision", async () => {
    const { contract, creator, id } = await fixture();
    const nonce = await creator.getNonce("pending");
    await ethers.provider.send("evm_setAutomine", [false]);
    try {
      const first = await contract.updatePrice(id, 1, 3000, { nonce, gasLimit: 200000 });
      const second = await contract.updatePrice(id, 1, 4000, { nonce: nonce + 1, gasLimit: 200000 });
      await ethers.provider.send("evm_mine", []);
      expect((await ethers.provider.getTransactionReceipt(first.hash))?.status).to.equal(1);
      expect((await ethers.provider.getTransactionReceipt(second.hash))?.status).to.equal(0);
      expect(await contract.revisions(id)).to.equal(2);
      expect((await contract.get(id)).fetchPriceUsdc6).to.equal(3000);
    } finally { await ethers.provider.send("evm_setAutomine", [true]); }
  });

  it("requires the creator for every mutator, not a payout or split recipient", async () => {
    const { contract, other, payout, id } = await fixture();
    for (const signer of [other, payout]) {
      await expect(contract.connect(signer).updatePrice(id, 1, 3000)).to.be.revertedWithCustomError(contract, "NotCreator");
      await expect(contract.connect(signer).deactivate(id, 1)).to.be.revertedWithCustomError(contract, "NotCreator");
      await expect(contract.connect(signer).update(id, 1, payout.address, [], 3000, "", "")).to.be.revertedWithCustomError(contract, "NotCreator");
    }
    expect(await contract.revisions(id)).to.equal(1);
  });

  it("rolls invalid writes back without consuming the revision", async () => {
    const { contract, payout, id } = await fixture();
    await expect(contract.update(id, 1, ethers.ZeroAddress, [], 3000, "", "")).to.be.revertedWithCustomError(contract, "ZeroAddress");
    await expect(contract.update(id, 1, payout.address, [{ wallet: payout.address, basisPoints: 9999 }], 3000, "", "")).to.be.revertedWithCustomError(contract, "BadSplit");
    await expect(contract.update(id, 1, payout.address, [{ wallet: payout.address, basisPoints: 10000 }], 3000, "x".repeat(129), "")).to.be.revertedWithCustomError(contract, "StringTooLong");
    expect(await contract.revisions(id)).to.equal(1);
    expect((await contract.get(id)).fetchPriceUsdc6).to.equal(2000);
  });

  it("increments revision on permanent delisting and rejects further edits", async () => {
    const { contract, payout, id } = await fixture();
    await expect(contract.deactivate(id, 1)).to.emit(contract, "SourceDeactivated");
    expect((await contract.getWithRevision(id)).revision).to.equal(2);
    expect((await contract.get(id)).active).to.equal(false);
    await expect(contract.updatePrice(id, 2, 3000)).to.be.revertedWithCustomError(contract, "InactiveSource");
    await expect(contract.update(id, 2, payout.address, [], 3000, "", "")).to.be.revertedWithCustomError(contract, "InactiveSource");
    await expect(contract.deactivate(id, 2)).to.be.revertedWithCustomError(contract, "InactiveSource");
  });

  it("does not expose unchecked legacy update or deactivate selectors", async () => {
    const { contract, creator, payout, id } = await fixture();
    const legacy = new ethers.Contract(await contract.getAddress(), [
      "function update(bytes32,address,(address wallet,uint16 basisPoints)[],uint64,string,string)", "function deactivate(bytes32)",
    ], creator);
    await expect(legacy.update(id, payout.address, [], 3000, "", "")).to.be.reverted;
    await expect(legacy.deactivate(id)).to.be.reverted;
    expect(await contract.revisions(id)).to.equal(1);
  });

  it("keeps creator-scoped registration and rejects duplicate registrations", async () => {
    const { contract, other, payout, urlHash, id } = await fixture();
    const authors = [{ wallet: payout.address, basisPoints: 10000 }];
    await expect(contract.register(urlHash, payout.address, authors, 2000, "", "")).to.be.revertedWithCustomError(contract, "AlreadyExists");
    await contract.connect(other).register(urlHash, payout.address, authors, 2000, "", "");
    const otherId = await contract.sourceIds(1);
    expect(otherId).not.to.equal(id);
    expect(await contract.revisions(otherId)).to.equal(1);
    await contract.updatePrice(id, 1, 3000);
    expect(await contract.revisions(otherId)).to.equal(1);
  });

  it("rejects invalid registration before creating a record or revision", async () => {
    const { contract, creator, payout } = await fixture();
    const hash = ethers.keccak256(ethers.toUtf8Bytes("new synthetic source"));
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [creator.address, hash]));
    const authors = [{ wallet: payout.address, basisPoints: 10000 }];
    await expect(contract.register(hash, payout.address, [], 2000, "", "")).to.be.revertedWithCustomError(contract, "BadSplit");
    await expect(contract.register(hash, ethers.ZeroAddress, authors, 2000, "", "")).to.be.revertedWithCustomError(contract, "ZeroAddress");
    await expect(contract.register(hash, payout.address, authors, 2000, "", "x".repeat(257))).to.be.revertedWithCustomError(contract, "StringTooLong");
    expect(await contract.revisions(id)).to.equal(0);
    expect((await contract.get(id)).creator).to.equal(ethers.ZeroAddress);
    await expect(contract.updatePrice(id, 0, 2000)).to.be.revertedWithCustomError(contract, "NotCreator");
  });
});
