import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract } from "ethers";
import { loadFixture, mine, time } from "@nomicfoundation/hardhat-network-helpers";

const unit = 1_000_000n;
const hash = (value: string) => ethers.id(value);
const category = hash("source-access");
const task = hash("original-research-task");
const transferTypes = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
] };

async function fixture() {
  const [owner, agent, payee, stranger] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("ResearchMandateTestUSDC")).deploy() as unknown as Contract;
  const now = await time.latest();
  const limits = { perPayment: 5n * unit, daily: 10n * unit, rollingWeek: 20n * unit,
    lifetime: 30n * unit, protectedReserve: 40n * unit, expiresAt: now + 30 * 86400 };
  const mandate = await (await ethers.getContractFactory("ResearchSpendingMandate"))
    .deploy(await token.getAddress(), owner.address, agent.address, limits) as unknown as Contract;
  await mandate.setCategory(category, 15n * unit);
  await mandate.setTask(task, 10n * unit);
  await mandate.setPayee(payee.address, true);
  await mandate.setSource(hash("creator-source"), payee.address);
  await token.mint(owner.address, 100n * unit);
  await token.approve(await mandate.getAddress(), 100n * unit);
  await mandate.fund(100n * unit);
  const buyer = mandate.connect(agent) as Contract;
  async function purchase(id = "one", amount = unit) {
    const clock = await time.latest();
    return { requestId: hash(id), taskHash: task, sourceId: hash("creator-source"),
      contentHash: hash("exact-content-version"), decisionHash: hash("decision-before-money"),
      category, payee: payee.address, amount,
      validUntil: Math.min(clock + 600, Math.floor(clock / 86400 + 1) * 86400 - 1) };
  }
  async function authorization(p: Awaited<ReturnType<typeof purchase>>) {
    const original = await mandate.getOriginal(p.requestId);
    const domain = { name: "Synthetic USDC", version: "2", chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await token.getAddress() };
    const transfer = { from: await mandate.getAddress(), to: p.payee, value: p.amount,
      validAfter: 0, validBefore: p.validUntil, nonce: original.nonce };
    const signature = await agent.signTypedData(domain, transferTypes, transfer);
    const envelope = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes"], [p.requestId, signature]);
    return { original, domain, transfer, envelope, digest: ethers.TypedDataEncoder.hash(domain, transferTypes, transfer) };
  }
  return { owner, agent, payee, stranger, token, mandate, buyer, limits, purchase, authorization };
}

describe("ResearchSpendingMandate financial authority", () => {
  it("refuses collapsing the bounded agent into the unrestricted owner address", async () => {
    const f = await loadFixture(fixture);
    await expect((await ethers.getContractFactory("ResearchSpendingMandate")).deploy(
      await f.token.getAddress(), f.owner.address, f.owner.address, f.limits)).to.be.revertedWithCustomError(f.mandate, "InvalidPolicy");
    await expect(f.mandate.setPolicy(f.owner.address, f.limits)).to.be.revertedWithCustomError(f.mandate, "InvalidPolicy");
    expect(await f.mandate.agent()).to.equal(f.agent.address);
  });
  it("checks an owner-appointed contract agent's EIP1271 signature and contains a refusing validator", async () => {
    const f = await loadFixture(fixture), p = await f.purchase();
    const wallet = await (await ethers.getContractFactory("ResearchMandateTestAgent")).deploy(f.agent.address) as unknown as Contract;
    const signerWallet = wallet.connect(f.agent) as Contract;
    await f.mandate.setPolicy(await wallet.getAddress(), f.limits);
    await signerWallet.execute(await f.mandate.getAddress(), f.mandate.interface.encodeFunctionData("prepare", [p]));
    await mine(); const auth = await f.authorization(p);
    expect(await f.mandate.isValidSignature(auth.digest, auth.envelope)).to.equal("0x1626ba7e");
    await signerWallet.setRefused(true);
    expect(await f.mandate.isValidSignature(auth.digest, auth.envelope)).to.equal("0xffffffff");
    await signerWallet.setRefused(false);
    await f.token.transferWithAuthorization(auth.transfer.from, auth.transfer.to, auth.transfer.value,
      auth.transfer.validAfter, auth.transfer.validBefore, auth.transfer.nonce, auth.envelope);
    await f.mandate.sync(p.requestId);
    expect(await f.mandate.settledTotal()).to.equal(unit); expect(await f.mandate.heldTotal()).to.equal(0);
  });
  it("does not drop a late-day commitment before the full 168-hour window has elapsed", async () => {
    const f = await loadFixture(fixture);
    await f.mandate.setCategory(category, 30n * unit); await f.mandate.setTask(task, 30n * unit);
    const firstDay = Math.floor(await time.latest() / 86400) + 1;
    for (let day = 0; day < 4; day++) {
      await time.increaseTo((firstDay + day) * 86400 + 23 * 3600 + 50 * 60);
      const p = await f.purchase(`week-${day}`, 5n * unit); await f.buyer.prepare(p); await f.buyer.pay(p.requestId);
    }
    await time.increaseTo((firstDay + 7) * 86400);
    expect(await f.mandate.rollingCommitted()).to.equal(20n * unit);
    await expect(f.buyer.prepare(await f.purchase("too-early", unit))).to.be.revertedWithCustomError(f.mandate, "PolicyRefused");
    await time.increaseTo((firstDay + 8) * 86400);
    expect(await f.mandate.rollingCommitted()).to.equal(15n * unit);
    await f.buyer.prepare(await f.purchase("safe-window", unit));
  });
  it("refuses payment and EIP1271 approval in the same block as the decision", async () => {
    const f = await loadFixture(fixture), p = await f.purchase();
    await ethers.provider.send("evm_setAutomine", [false]);
    try {
      const nonce = await f.agent.getNonce();
      const prepared = await f.buyer.prepare(p, { nonce, gasLimit: 1_000_000 });
      const paid = await f.buyer.pay(p.requestId, { nonce: nonce + 1, gasLimit: 1_000_000 });
      await mine(); await prepared.wait();
      const receipt = await ethers.provider.getTransactionReceipt(paid.hash);
      expect(receipt?.status).to.equal(0);
      const auth = await f.authorization(p);
      expect(await f.mandate.isValidSignature(auth.digest, auth.envelope)).to.equal("0xffffffff");
      expect(await f.token.balanceOf(f.payee.address)).to.equal(0);
      expect(await f.mandate.heldTotal()).to.equal(unit);
    } finally { await ethers.provider.send("evm_setAutomine", [true]); }
    await f.buyer.pay(p.requestId);
    expect(await f.token.balanceOf(f.payee.address)).to.equal(unit);
  });

  it("rejects an exact valid transfer digest signed by an unappointed agent", async () => {
    const f = await loadFixture(fixture), p = await f.purchase(); await f.buyer.prepare(p); await mine();
    const auth = await f.authorization(p);
    const forged = await f.stranger.signTypedData(auth.domain, transferTypes, auth.transfer);
    const envelope = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes"], [p.requestId, forged]);
    expect(await f.mandate.isValidSignature(auth.digest, envelope)).to.equal("0xffffffff");
    await expect(f.token.transferWithAuthorization(auth.transfer.from, auth.transfer.to, auth.transfer.value,
      auth.transfer.validAfter, auth.transfer.validBefore, auth.transfer.nonce, envelope)).to.be.reverted;
    expect(await f.mandate.heldTotal()).to.equal(unit);
  });
  it("retains one exact decision before a direct payment and reconciles separate commitment/held/settled totals", async () => {
    const f = await loadFixture(fixture), p = await f.purchase();
    await expect(f.buyer.prepare(p)).to.emit(f.mandate, "PurchasePrepared");
    expect(await f.mandate.committedTotal()).to.equal(unit);
    expect(await f.mandate.heldTotal()).to.equal(unit);
    expect(await f.mandate.settledTotal()).to.equal(0);
    await expect(f.buyer.pay(p.requestId)).to.emit(f.mandate, "PurchasePaid");
    expect(await f.token.balanceOf(f.payee.address)).to.equal(unit);
    expect(await f.mandate.heldTotal()).to.equal(0);
    expect(await f.mandate.settledTotal()).to.equal(unit);
    expect(await f.mandate.committedTotal()).to.equal(unit);
    await expect(f.buyer.pay(p.requestId)).to.be.reverted;
  });

  it("returns the original on exact preparation replay and rejects an altered binding", async () => {
    const f = await loadFixture(fixture), p = await f.purchase();
    await f.buyer.prepare(p);
    const prior = await f.mandate.getOriginal(p.requestId);
    await f.buyer.prepare(p);
    expect((await f.mandate.getOriginal(p.requestId)).nonce).to.equal(prior.nonce);
    expect(await f.mandate.heldTotal()).to.equal(unit);
    for (const patch of [{ amount: 2n * unit }, { contentHash: hash("changed-content") },
      { decisionHash: hash("changed-decision") }, { payee: f.stranger.address }])
      await expect(f.buyer.prepare({ ...p, ...patch })).to.be.revertedWithCustomError(f.mandate, "RequestConflict");
  });

  it("supports the exact prior committed EIP3009 transfer and preserves its unresolved hold until chain consumption is synced", async () => {
    const f = await loadFixture(fixture), p = await f.purchase();
    await f.buyer.prepare(p);
    const a = await f.authorization(p);
    expect(await f.mandate.isValidSignature(a.digest, a.envelope)).to.equal("0xffffffff");
    await mine();
    expect(await f.mandate.isValidSignature(a.digest, a.envelope)).to.equal("0x1626ba7e");
    await f.token.transferWithAuthorization(a.transfer.from, a.transfer.to, a.transfer.value,
      a.transfer.validAfter, a.transfer.validBefore, a.transfer.nonce, a.envelope);
    expect(await f.token.balanceOf(f.payee.address)).to.equal(unit);
    expect(await f.mandate.heldTotal()).to.equal(unit);
    expect(await f.mandate.settledTotal()).to.equal(0);
    await expect(f.buyer.pay(p.requestId)).to.be.reverted;
    await expect(f.mandate.release(p.requestId)).to.be.reverted;
    await f.mandate.connect(f.stranger).getFunction("sync")(p.requestId);
    expect(await f.mandate.heldTotal()).to.equal(0);
    expect(await f.mandate.settledTotal()).to.equal(unit);
    expect(await f.mandate.committedTotal()).to.equal(unit);
    await expect(f.mandate.sync(p.requestId)).to.be.reverted;
  });

  it("refuses an already exposed x402 authorization after direct payment", async () => {
    const f = await loadFixture(fixture), p = await f.purchase();
    await f.buyer.prepare(p); const a = await f.authorization(p);
    await f.buyer.pay(p.requestId);
    await expect(f.token.transferWithAuthorization(a.transfer.from, a.transfer.to, a.transfer.value,
      a.transfer.validAfter, a.transfer.validBefore, a.transfer.nonce, a.envelope)).to.be.revertedWith("invalid signature");
    expect(await f.token.balanceOf(f.payee.address)).to.equal(unit);
  });

  it("binds signature to the exact token/domain, recipient, amount, expiry and nonce", async () => {
    const f = await loadFixture(fixture), p = await f.purchase();
    await f.buyer.prepare(p); await mine(); const a = await f.authorization(p);
    for (const patch of [{ to: f.stranger.address }, { value: p.amount + 1n },
      { validBefore: p.validUntil + 1 }, { nonce: hash("foreign-nonce") }, { validAfter: 1 }]) {
      const digest = ethers.TypedDataEncoder.hash(a.domain, transferTypes, { ...a.transfer, ...patch });
      expect(await f.mandate.isValidSignature(digest, a.envelope)).to.equal("0xffffffff");
    }
    expect(await f.mandate.isValidSignature(ethers.TypedDataEncoder.hash({ ...a.domain, chainId: 1 }, transferTypes, a.transfer), a.envelope)).to.equal("0xffffffff");
    expect(await f.mandate.isValidSignature(hash("permit"), a.envelope)).to.equal("0xffffffff");
    for (const malformed of ["0x", "0x1234", ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [p.requestId])])
      expect(await f.mandate.isValidSignature(a.digest, malformed)).to.equal("0xffffffff");
  });

  it("invalidates old signatures permanently through pause/resume and owner policy changes", async () => {
    const f = await loadFixture(fixture), p = await f.purchase();
    await f.buyer.prepare(p); await mine(); const a = await f.authorization(p);
    await f.mandate.setPaused(true); await f.mandate.setPaused(false);
    expect(await f.mandate.isValidSignature(a.digest, a.envelope)).to.equal("0xffffffff");
    await expect(f.buyer.pay(p.requestId)).to.be.reverted;
    await f.mandate.release(p.requestId);
    expect(await f.mandate.heldTotal()).to.equal(0);
    await f.buyer.prepare(p);
    expect((await f.mandate.getOriginal(p.requestId)).state).to.equal(3n);
  });

  it("never releases an unexpired unresolved authorization and cannot double-release an expired original", async () => {
    const f = await loadFixture(fixture), p = await f.purchase(); await f.buyer.prepare(p);
    await expect(f.mandate.release(p.requestId)).to.be.revertedWithCustomError(f.mandate, "LiabilityUnresolved");
    await expect(f.mandate.sync(p.requestId)).to.be.revertedWithCustomError(f.mandate, "LiabilityUnresolved");
    expect(await f.mandate.heldTotal()).to.equal(unit);
    await time.increaseTo(p.validUntil + 1);
    await f.mandate.release(p.requestId);
    expect(await f.mandate.committedTotal()).to.equal(0);
    await expect(f.mandate.release(p.requestId)).to.be.reverted;
    await expect(f.buyer.pay(p.requestId)).to.be.reverted;
  });

  it("keeps every successful allocation within daily, category and task limits including pending intents", async () => {
    const f = await loadFixture(fixture);
    await f.buyer.prepare(await f.purchase("a", 5n * unit));
    await f.buyer.prepare(await f.purchase("b", 5n * unit));
    await expect(f.buyer.prepare(await f.purchase("c", unit))).to.be.revertedWithCustomError(f.mandate, "PolicyRefused");
    expect(await f.mandate.committedTotal()).to.equal(10n * unit);
    expect(await f.mandate.heldTotal()).to.equal(10n * unit);
    expect(await f.token.balanceOf(await f.mandate.getAddress())).to.equal(100n * unit);
  });

  it("fails closed on unconfigured task/category, prohibited recipient and incomplete decision identity", async () => {
    const f = await loadFixture(fixture), p = await f.purchase();
    for (const patch of [{ taskHash: hash("unconfigured-task") }, { category: hash("unconfigured-category") },
      { payee: f.stranger.address }, { amount: 0 }, { amount: 5n * unit + 1n },
      { decisionHash: ethers.ZeroHash }, { contentHash: ethers.ZeroHash }, { sourceId: ethers.ZeroHash },
      { sourceId: hash("unreviewed-source") },
      { requestId: ethers.ZeroHash }, { validUntil: p.validUntil + 86400 }])
      await expect(f.buyer.prepare({ ...p, ...patch })).to.be.reverted;
    expect(await f.mandate.heldTotal()).to.equal(0);
  });

  it("preserves unpaid reserve even when the owner has withdrawn the available funds", async () => {
    const f = await loadFixture(fixture); await f.mandate.withdraw(f.owner.address, 60n * unit);
    await expect(f.buyer.prepare(await f.purchase())).to.be.revertedWithCustomError(f.mandate, "PolicyRefused");
    await f.mandate.setPaused(true); await f.mandate.withdraw(f.owner.address, 40n * unit);
    expect(await f.token.balanceOf(await f.mandate.getAddress())).to.equal(0);
  });

  it("rolls back payment state when the token refuses delivery", async () => {
    const f = await loadFixture(fixture), p = await f.purchase(); await f.buyer.prepare(p);
    await f.token.setTransferFailure(true);
    await expect(f.buyer.pay(p.requestId)).to.be.reverted;
    expect((await f.mandate.getOriginal(p.requestId)).state).to.equal(1n);
    expect(await f.mandate.heldTotal()).to.equal(unit);
    expect(await f.mandate.settledTotal()).to.equal(0);
  });

  it("cannot change authority, fund or withdraw from the agent or a stranger", async () => {
    const f = await loadFixture(fixture), p = await f.purchase();
    await expect(f.mandate.connect(f.stranger).getFunction("prepare")(p)).to.be.reverted;
    for (const [name, args] of [["setPaused", [true]], ["setPayee", [f.stranger.address, true]],
      ["setTask", [task, 100n * unit]], ["setCategory", [category, 100n * unit]],
      ["setSource", [hash("creator-source"), f.stranger.address]],
      ["fund", [unit]], ["withdraw", [f.stranger.address, unit]]] as const)
      await expect(f.buyer.getFunction(name)(...args)).to.be.revertedWithCustomError(f.mandate, "OwnerOnly");
  });

  it("does not reset lifetime consumption when rules or UTC days change", async () => {
    const f = await loadFixture(fixture);
    await f.mandate.setTask(task, 100n * unit); await f.mandate.setCategory(category, 100n * unit);
    await f.mandate.setPolicy(f.agent.address, { ...f.limits, perPayment: 5n * unit, daily: 5n * unit,
      rollingWeek: 5n * unit, lifetime: 5n * unit });
    const p = await f.purchase("first", 5n * unit); await f.buyer.prepare(p); await f.buyer.pay(p.requestId);
    await time.increase(8 * 86400);
    expect(await f.mandate.rollingCommitted()).to.equal(0);
    await expect(f.buyer.prepare(await f.purchase("second", unit))).to.be.revertedWithCustomError(f.mandate, "PolicyRefused");
    expect(await f.mandate.committedTotal()).to.equal(5n * unit);
  });
});
