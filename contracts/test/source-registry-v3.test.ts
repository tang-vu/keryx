import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { TypedDataDomain } from "ethers";
import type { SourceRegistryV3 } from "../../typechain-types";

type AuthorSplit = { wallet: string; basisPoints: number };
type RegistrationRequest = {
  creator: string;
  relayer: string;
  urlHash: string;
  payoutWallet: string;
  authors: AuthorSplit[];
  fetchPriceUsdc6: bigint;
  contentCid: string;
  tags: string;
  nonce: bigint;
  deadline: bigint;
};

const registrationTypes = {
  Registration: [
    { name: "creator", type: "address" },
    { name: "relayer", type: "address" },
    { name: "urlHash", type: "bytes32" },
    { name: "payoutWallet", type: "address" },
    { name: "authorsHash", type: "bytes32" },
    { name: "fetchPriceUsdc6", type: "uint64" },
    { name: "contentCidHash", type: "bytes32" },
    { name: "tagsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
};

function hashText(text: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(text));
}

function sourceId(creator: string, urlHash: string): string {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [creator, urlHash]));
}

function registrationMessage(request: RegistrationRequest) {
  return {
    creator: request.creator,
    relayer: request.relayer,
    urlHash: request.urlHash,
    payoutWallet: request.payoutWallet,
    authorsHash: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address wallet,uint16 basisPoints)[]"], [request.authors],
    )),
    fetchPriceUsdc6: request.fetchPriceUsdc6,
    contentCidHash: hashText(request.contentCid),
    tagsHash: hashText(request.tags),
    nonce: request.nonce,
    deadline: request.deadline,
  };
}

async function signRegistration(
  contract: SourceRegistryV3,
  creator: HardhatEthersSigner,
  request: RegistrationRequest,
  domainOverrides: Partial<TypedDataDomain> = {},
): Promise<string> {
  return creator.signTypedData({
    name: "KeryxSourceRegistry",
    version: "3",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await contract.getAddress(),
    ...domainOverrides,
  }, registrationTypes, registrationMessage(request));
}

async function fixture() {
  const [creator, relayer, payout, author, other] = await ethers.getSigners();
  const contract = await (await ethers.getContractFactory("SourceRegistryV3")).deploy() as SourceRegistryV3;
  const latest = await ethers.provider.getBlock("latest");
  const request: RegistrationRequest = {
    creator: creator.address,
    relayer: relayer.address,
    urlHash: hashText("https://synthetic.invalid/feed"),
    payoutWallet: payout.address,
    authors: [{ wallet: creator.address, basisPoints: 4000 }, { wallet: author.address, basisPoints: 6000 }],
    fetchPriceUsdc6: 2000n,
    contentCid: "bafy-synthetic-content",
    tags: "research,kiểm-thử",
    nonce: 0n,
    deadline: BigInt(latest!.timestamp + 3600),
  };
  const signature = await signRegistration(contract, creator, request);
  const id = sourceId(creator.address, request.urlHash);
  return { contract, creator, relayer, payout, author, other, request, signature, id };
}

async function registeredFixture() {
  const context = await fixture();
  await context.contract.connect(context.relayer).registerWithSignature(context.request, context.signature);
  return context;
}

describe("SourceRegistryV3 candidate (local EVM only)", () => {
  it("registers the signed creator, metadata and splits with unchanged source/event identity", async () => {
    const { contract, creator, relayer, request, signature, id } = await fixture();
    expect(await contract.registryVersion()).to.equal(3);
    await expect(contract.connect(relayer).registerWithSignature(request, signature))
      .to.emit(contract, "SourceRegistered").withArgs(id, creator.address, request.contentCid);
    const state = await contract.getWithRevision(id);
    expect(state.record.creator).to.equal(creator.address);
    expect(state.record.payoutWallet).to.equal(request.payoutWallet);
    expect(state.record.authors.map((split) => [split.wallet, split.basisPoints]))
      .to.deep.equal(request.authors.map((split) => [split.wallet, BigInt(split.basisPoints)]));
    expect(state.record.fetchPriceUsdc6).to.equal(request.fetchPriceUsdc6);
    expect(state.record.contentCid).to.equal(request.contentCid);
    expect(state.record.tags).to.equal(request.tags);
    expect(state.record.active).to.equal(true);
    expect(state.revision).to.equal(1);
    expect(await contract.sourceIds(0)).to.equal(id);
    expect(await contract.sourceCount()).to.equal(1);
    expect(await contract.registrationNonces(creator.address)).to.equal(1);
    expect((await contract.get(sourceId(relayer.address, request.urlHash))).creator).to.equal(ethers.ZeroAddress);
    expect(await contract.registrationNonces(relayer.address)).to.equal(0);
  });

  it("retains direct register arguments, events and creator-scoped identity without consuming a signature nonce", async () => {
    const { contract, creator, request, id } = await fixture();
    await expect(contract.register(
      request.urlHash, request.payoutWallet, request.authors,
      request.fetchPriceUsdc6, request.contentCid, request.tags,
    )).to.emit(contract, "SourceRegistered").withArgs(id, creator.address, request.contentCid);
    expect((await contract.getWithRevision(id)).revision).to.equal(1);
    expect((await contract.get(id)).creator).to.equal(creator.address);
    expect(await contract.registrationNonces(creator.address)).to.equal(0);
    await expect(contract.register(
      request.urlHash, request.payoutWallet, request.authors,
      request.fetchPriceUsdc6, request.contentCid, request.tags,
    )).to.be.revertedWithCustomError(contract, "AlreadyExists");
  });

  it("keeps the same URL independent for other creators and the relayer", async () => {
    const { contract, creator, relayer, request, signature, id } = await fixture();
    await contract.connect(relayer).register(
      request.urlHash, relayer.address, [{ wallet: relayer.address, basisPoints: 10000 }], 1, "", "",
    );
    await contract.connect(relayer).registerWithSignature(request, signature);
    expect(await contract.sourceCount()).to.equal(2);
    expect((await contract.get(id)).creator).to.equal(creator.address);
    expect((await contract.get(sourceId(relayer.address, request.urlHash))).creator).to.equal(relayer.address);
  });

  it("rejects a different submitter even with an unchanged valid creator signature", async () => {
    const { contract, other, request, signature, creator } = await fixture();
    await expect(contract.connect(other).registerWithSignature(request, signature))
      .to.be.revertedWithCustomError(contract, "InvalidRelayer");
    expect(await contract.registrationNonces(creator.address)).to.equal(0);
    expect(await contract.sourceCount()).to.equal(0);
  });

  const substitutions: {
    name: string;
    change: (request: RegistrationRequest, address: string) => RegistrationRequest;
    error: string;
  }[] = [
    { name: "creator", change: (request, address) => ({ ...request, creator: address }), error: "InvalidRegistrationSignature" },
    { name: "relayer", change: (request, address) => ({ ...request, relayer: address }), error: "InvalidRegistrationSignature" },
    { name: "URL hash", change: (request) => ({ ...request, urlHash: hashText("substituted URL") }), error: "InvalidRegistrationSignature" },
    { name: "payout wallet", change: (request, address) => ({ ...request, payoutWallet: address }), error: "InvalidRegistrationSignature" },
    { name: "author wallet", change: (request, address) => ({ ...request, authors: [{ ...request.authors[0], wallet: address }, request.authors[1]] }), error: "InvalidRegistrationSignature" },
    { name: "author weight", change: (request) => ({ ...request, authors: [{ ...request.authors[0], basisPoints: 5000 }, { ...request.authors[1], basisPoints: 5000 }] }), error: "InvalidRegistrationSignature" },
    { name: "author order", change: (request) => ({ ...request, authors: [...request.authors].reverse() }), error: "InvalidRegistrationSignature" },
    { name: "price", change: (request) => ({ ...request, fetchPriceUsdc6: request.fetchPriceUsdc6 + 1n }), error: "InvalidRegistrationSignature" },
    { name: "content CID", change: (request) => ({ ...request, contentCid: "substituted-cid" }), error: "InvalidRegistrationSignature" },
    { name: "tags", change: (request) => ({ ...request, tags: "substituted-tags" }), error: "InvalidRegistrationSignature" },
    { name: "nonce", change: (request) => ({ ...request, nonce: 1n }), error: "InvalidRegistrationNonce" },
    { name: "deadline", change: (request) => ({ ...request, deadline: request.deadline + 1n }), error: "InvalidRegistrationSignature" },
  ];

  for (const substitution of substitutions) {
    it(`rejects substitution of the signed ${substitution.name}`, async () => {
      const { contract, creator, relayer, other, request, signature } = await fixture();
      const altered = substitution.change(request, other.address);
      const submitter = substitution.name === "relayer" ? other : relayer;
      await expect(contract.connect(submitter).registerWithSignature(altered, signature))
        .to.be.revertedWithCustomError(contract, substitution.error);
      expect(await contract.registrationNonces(creator.address)).to.equal(0);
      expect(await contract.registrationNonces(other.address)).to.equal(0);
      expect(await contract.sourceCount()).to.equal(0);
    });
  }

  for (const field of ["chain", "contract", "name", "version"] as const) {
    it(`rejects a signature made for another domain ${field}`, async () => {
      const { contract, creator, relayer, other, request } = await fixture();
      const overrides: Partial<TypedDataDomain> = {
        chain: { chainId: (await ethers.provider.getNetwork()).chainId + 1n },
        contract: { verifyingContract: other.address },
        name: { name: "UnrelatedRegistry" },
        version: { version: "2" },
      }[field];
      const signature = await signRegistration(contract, creator, request, overrides);
      await expect(contract.connect(relayer).registerWithSignature(request, signature))
        .to.be.revertedWithCustomError(contract, "InvalidRegistrationSignature");
      expect(await contract.registrationNonces(creator.address)).to.equal(0);
    });
  }

  it("rejects a valid signature from a wallet other than the named creator", async () => {
    const { contract, relayer, other, request, creator } = await fixture();
    const signature = await signRegistration(contract, other, request);
    await expect(contract.connect(relayer).registerWithSignature(request, signature))
      .to.be.revertedWithCustomError(contract, "InvalidRegistrationSignature");
    expect(await contract.registrationNonces(creator.address)).to.equal(0);
  });

  it("rejects a zero creator before signature recovery", async () => {
    const { contract, relayer, request, signature } = await fixture();
    await expect(contract.connect(relayer).registerWithSignature({ ...request, creator: ethers.ZeroAddress }, signature))
      .to.be.revertedWithCustomError(contract, "ZeroAddress");
    expect(await contract.sourceCount()).to.equal(0);
  });

  it("does not treat an EOA signature as contract-wallet authorization", async () => {
    const { contract, creator, relayer, request } = await fixture();
    const altered = { ...request, creator: await contract.getAddress() };
    const signature = await signRegistration(contract, creator, altered);
    await expect(contract.connect(relayer).registerWithSignature(altered, signature))
      .to.be.revertedWithCustomError(contract, "InvalidRegistrationSignature");
  });

  it("rejects malformed and high-s signatures without consuming nonce or creating state", async () => {
    const { contract, creator, relayer, request, signature } = await fixture();
    await expect(contract.connect(relayer).registerWithSignature(request, "0x12"))
      .to.be.revertedWithCustomError(contract, "ECDSAInvalidSignatureLength").withArgs(1);
    const original = ethers.Signature.from(signature);
    const curveOrder = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
    const highS = ethers.toBeHex(curveOrder - BigInt(original.s), 32);
    const malleable = ethers.concat([original.r, highS, ethers.toBeHex(original.v === 27 ? 28 : 27, 1)]);
    await expect(contract.connect(relayer).registerWithSignature(request, malleable))
      .to.be.revertedWithCustomError(contract, "ECDSAInvalidSignatureS").withArgs(highS);
    await expect(contract.connect(relayer).registerWithSignature(request, "0x" + "00".repeat(65)))
      .to.be.revertedWithCustomError(contract, "ECDSAInvalidSignature");
    expect(await contract.registrationNonces(creator.address)).to.equal(0);
    expect(await contract.sourceCount()).to.equal(0);
  });

  it("rejects expired authorization while allowing the exact deadline", async () => {
    const { contract, creator, relayer, request } = await fixture();
    const atDeadline = { ...request, deadline: request.deadline };
    const signature = await signRegistration(contract, creator, atDeadline);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(atDeadline.deadline)]);
    await contract.connect(relayer).registerWithSignature(atDeadline, signature);
    const expired = { ...request, nonce: 1n, urlHash: hashText("expired second source") };
    await expect(contract.connect(relayer).registerWithSignature(expired, await signRegistration(contract, creator, expired)))
      .to.be.revertedWithCustomError(contract, "RegistrationExpired");
    expect(await contract.registrationNonces(creator.address)).to.equal(1);
    expect(await contract.sourceCount()).to.equal(1);
  });

  it("rejects replay and future nonce; accepts a new sequential authorization", async () => {
    const { contract, creator, relayer, request, signature } = await registeredFixture();
    await expect(contract.connect(relayer).registerWithSignature(request, signature))
      .to.be.revertedWithCustomError(contract, "InvalidRegistrationNonce").withArgs(1, 0);
    const future = { ...request, nonce: 2n, urlHash: hashText("future source") };
    await expect(contract.connect(relayer).registerWithSignature(future, await signRegistration(contract, creator, future)))
      .to.be.revertedWithCustomError(contract, "InvalidRegistrationNonce").withArgs(1, 2);
    const next = { ...future, nonce: 1n };
    await contract.connect(relayer).registerWithSignature(next, await signRegistration(contract, creator, next));
    expect(await contract.registrationNonces(creator.address)).to.equal(2);
    expect(await contract.sourceCount()).to.equal(2);
  });

  it("rejects changing a used signature to the next live nonce", async () => {
    const { contract, creator, relayer, request, signature } = await registeredFixture();
    // The sequential check now accepts 1, so signature recovery itself must bind
    // the original nonce rather than relying only on the stored nonce comparison.
    await expect(contract.connect(relayer).registerWithSignature({ ...request, nonce: 1n }, signature))
      .to.be.revertedWithCustomError(contract, "InvalidRegistrationSignature");
    expect(await contract.registrationNonces(creator.address)).to.equal(1);
    expect(await contract.sourceCount()).to.equal(1);
  });

  it("allows only one of two queued registrations signed with the same creator nonce", async () => {
    const { contract, creator, relayer, request, signature } = await fixture();
    const competing = { ...request, urlHash: hashText("competing source") };
    const competingSignature = await signRegistration(contract, creator, competing);
    const nonce = await relayer.getNonce("pending");
    await ethers.provider.send("evm_setAutomine", [false]);
    try {
      const first = await contract.connect(relayer).registerWithSignature(request, signature, { nonce, gasLimit: 800000 });
      const second = await contract.connect(relayer).registerWithSignature(competing, competingSignature, { nonce: nonce + 1, gasLimit: 800000 });
      await ethers.provider.send("evm_mine", []);
      expect((await ethers.provider.getTransactionReceipt(first.hash))?.status).to.equal(1);
      expect((await ethers.provider.getTransactionReceipt(second.hash))?.status).to.equal(0);
      expect(await contract.registrationNonces(creator.address)).to.equal(1);
      expect(await contract.sourceCount()).to.equal(1);
      expect((await contract.get(sourceId(creator.address, competing.urlHash))).creator).to.equal(ethers.ZeroAddress);
    } finally {
      await ethers.provider.send("evm_setAutomine", [true]);
    }
  });

  it("keeps each creator's sequential nonce independent", async () => {
    const { contract, creator, relayer, other, request, signature } = await fixture();
    await contract.connect(relayer).registerWithSignature(request, signature);
    const independent = { ...request, creator: other.address };
    await contract.connect(relayer).registerWithSignature(independent, await signRegistration(contract, other, independent));
    expect(await contract.registrationNonces(creator.address)).to.equal(1);
    expect(await contract.registrationNonces(other.address)).to.equal(1);
    expect(await contract.sourceCount()).to.equal(2);
  });

  const invalidRegistrations: {
    name: string;
    change: (request: RegistrationRequest) => RegistrationRequest;
    error: string;
  }[] = [
    { name: "zero payout", change: (request) => ({ ...request, payoutWallet: ethers.ZeroAddress }), error: "ZeroAddress" },
    { name: "empty split", change: (request) => ({ ...request, authors: [] }), error: "BadSplit" },
    { name: "zero author wallet", change: (request) => ({ ...request, authors: [{ wallet: ethers.ZeroAddress, basisPoints: 10000 }] }), error: "ZeroAddress" },
    { name: "zero author weight", change: (request) => ({ ...request, authors: [{ ...request.authors[0], basisPoints: 10000 }, { ...request.authors[1], basisPoints: 0 }] }), error: "BadSplit" },
    { name: "incorrect split total", change: (request) => ({ ...request, authors: [{ ...request.authors[0], basisPoints: 9999 }] }), error: "BadSplit" },
    { name: "too many authors", change: (request) => ({ ...request, authors: Array.from({ length: 21 }, () => ({ ...request.authors[0], basisPoints: 1 })) }), error: "BadSplit" },
    // EIP712 also includes ShortStrings.StringTooLong(string); use the complete
    // signature to assert this registry's preserved no-argument metadata error.
    { name: "oversized CID", change: (request) => ({ ...request, contentCid: "x".repeat(129) }), error: "StringTooLong()" },
    { name: "oversized tags in UTF-8 bytes", change: (request) => ({ ...request, tags: "é".repeat(129) }), error: "StringTooLong()" },
  ];

  for (const invalid of invalidRegistrations) {
    it(`rolls back signed registration with ${invalid.name}, preserving the original nonce`, async () => {
      const { contract, creator, relayer, request, signature, id } = await fixture();
      const altered = invalid.change(request);
      const invalidSignature = await signRegistration(contract, creator, altered);
      await expect(contract.connect(relayer).registerWithSignature(altered, invalidSignature))
        .to.be.revertedWithCustomError(contract, invalid.error);
      expect(await contract.registrationNonces(creator.address)).to.equal(0);
      expect(await contract.sourceCount()).to.equal(0);
      expect(await contract.revisions(id)).to.equal(0);
      expect((await contract.get(id)).creator).to.equal(ethers.ZeroAddress);
      await contract.connect(relayer).registerWithSignature(request, signature);
      expect(await contract.registrationNonces(creator.address)).to.equal(1);
    });
  }

  it("rejects duplicate source registration without burning a new creator nonce", async () => {
    const { contract, creator, relayer, request } = await registeredFixture();
    const duplicate = { ...request, nonce: 1n };
    await expect(contract.connect(relayer).registerWithSignature(duplicate, await signRegistration(contract, creator, duplicate)))
      .to.be.revertedWithCustomError(contract, "AlreadyExists");
    expect(await contract.registrationNonces(creator.address)).to.equal(1);
    expect(await contract.sourceCount()).to.equal(1);
    const next = { ...duplicate, urlHash: hashText("different source") };
    await contract.connect(relayer).registerWithSignature(next, await signRegistration(contract, creator, next));
    expect(await contract.registrationNonces(creator.address)).to.equal(2);
  });

  it("rejects an earlier signature after direct registration without changing its nonce", async () => {
    const { contract, creator, relayer, request, signature } = await fixture();
    await contract.register(request.urlHash, request.payoutWallet, request.authors, request.fetchPriceUsdc6, request.contentCid, request.tags);
    await expect(contract.connect(relayer).registerWithSignature(request, signature))
      .to.be.revertedWithCustomError(contract, "AlreadyExists");
    expect(await contract.registrationNonces(creator.address)).to.equal(0);
    const next = { ...request, urlHash: hashText("different direct/signed source") };
    await contract.connect(relayer).registerWithSignature(next, await signRegistration(contract, creator, next));
    expect(await contract.registrationNonces(creator.address)).to.equal(1);
  });

  it("permits only the creator, excluding relayer, payout and split recipients, to mutate the source", async () => {
    const { contract, creator, relayer, payout, author, other, id } = await registeredFixture();
    for (const signer of [relayer, payout, author, other]) {
      await expect(contract.connect(signer).updatePrice(id, 1, 3000)).to.be.revertedWithCustomError(contract, "NotCreator");
      await expect(contract.connect(signer).deactivate(id, 1)).to.be.revertedWithCustomError(contract, "NotCreator");
      await expect(contract.connect(signer).update(id, 1, signer.address, [], 3000, "", ""))
        .to.be.revertedWithCustomError(contract, "NotCreator");
    }
    await expect(contract.connect(creator).updatePrice(id, 1, 3000))
      .to.emit(contract, "SourceUpdated").withArgs(id, creator.address);
    expect(await contract.revisions(id)).to.equal(2);
    expect(await contract.registrationNonces(creator.address)).to.equal(1);
  });

  it("rejects obsolete price, full update and delist actions after a creator payout change", async () => {
    const { contract, creator, payout, request, id } = await registeredFixture();
    await contract.update(id, 1, creator.address, [{ wallet: creator.address, basisPoints: 10000 }], 2000, "new-cid", "new-tags");
    await expect(contract.updatePrice(id, 1, 3000)).to.be.revertedWithCustomError(contract, "StaleRevision").withArgs(1, 2);
    await expect(contract.update(id, 1, payout.address, request.authors, 3000, "old-cid", "old-tags"))
      .to.be.revertedWithCustomError(contract, "StaleRevision");
    await expect(contract.deactivate(id, 1)).to.be.revertedWithCustomError(contract, "StaleRevision");
    const state = await contract.getWithRevision(id);
    expect(state.record.payoutWallet).to.equal(creator.address);
    expect(state.record.contentCid).to.equal("new-cid");
    expect(state.record.fetchPriceUsdc6).to.equal(2000);
    expect(state.record.active).to.equal(true);
    expect(state.revision).to.equal(2);
  });

  it("updates only price after a refreshed revision and rejects ABA snapshots", async () => {
    const { contract, id } = await registeredFixture();
    const before = (await contract.getWithRevision(id)).record;
    await contract.updatePrice(id, 1, 3000);
    const after = (await contract.getWithRevision(id)).record;
    expect(after.fetchPriceUsdc6).to.equal(3000);
    for (const key of ["creator", "payoutWallet", "authors", "contentCid", "tags", "active"] as const) {
      expect(after[key]).to.deep.equal(before[key]);
    }
    await contract.updatePrice(id, 2, 2000);
    await expect(contract.updatePrice(id, 1, 4000)).to.be.revertedWithCustomError(contract, "StaleRevision").withArgs(1, 3);
  });

  it("accepts only one of two queued creator edits using the same revision", async () => {
    const { contract, creator, id } = await registeredFixture();
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
    } finally {
      await ethers.provider.send("evm_setAutomine", [true]);
    }
  });

  it("rolls invalid updates back without consuming source revision or registration nonce", async () => {
    const { contract, creator, request, id } = await registeredFixture();
    for (const invalid of invalidRegistrations) {
      const altered = invalid.change(request);
      await expect(contract.update(id, 1, altered.payoutWallet, altered.authors, altered.fetchPriceUsdc6, altered.contentCid, altered.tags))
        .to.be.revertedWithCustomError(contract, invalid.error);
    }
    expect(await contract.revisions(id)).to.equal(1);
    expect(await contract.registrationNonces(creator.address)).to.equal(1);
    expect((await contract.get(id)).fetchPriceUsdc6).to.equal(request.fetchPriceUsdc6);
  });

  it("permanently delists at the current revision and rejects further edits", async () => {
    const { contract, request, id } = await registeredFixture();
    await expect(contract.deactivate(id, 1)).to.emit(contract, "SourceDeactivated").withArgs(id);
    expect((await contract.getWithRevision(id)).revision).to.equal(2);
    expect((await contract.get(id)).active).to.equal(false);
    await expect(contract.updatePrice(id, 2, 3000)).to.be.revertedWithCustomError(contract, "InactiveSource");
    await expect(contract.update(id, 2, request.payoutWallet, request.authors, 3000, "", ""))
      .to.be.revertedWithCustomError(contract, "InactiveSource");
    await expect(contract.deactivate(id, 2)).to.be.revertedWithCustomError(contract, "InactiveSource");
  });

  it("exposes no unchecked legacy edit selectors", async () => {
    const { contract, creator, request, id } = await registeredFixture();
    const legacy = new ethers.Contract(await contract.getAddress(), [
      "function update(bytes32,address,(address wallet,uint16 basisPoints)[],uint64,string,string)",
      "function updatePrice(bytes32,uint64)",
      "function deactivate(bytes32)",
    ], creator);
    await expect(legacy.update(id, request.payoutWallet, request.authors, 3000, "", "")).to.be.reverted;
    await expect(legacy.updatePrice(id, 3000)).to.be.reverted;
    await expect(legacy.deactivate(id)).to.be.reverted;
    expect(await contract.revisions(id)).to.equal(1);
    expect((await contract.get(id)).active).to.equal(true);
  });
});
