/**
 * SourceRegistry Hardhat tests — security access-control and validation coverage.
 *
 * Covers:
 *   - register: happy path
 *   - AlreadyExists: duplicate id (same caller + same urlHash)
 *   - NotCreator: non-creator update and deactivate reverts
 *   - BadSplit: authors not summing to 10_000; zero-bp author
 *   - ZeroAddress: zero payout wallet; zero author wallet
 *   - StringTooLong: oversized CID; oversized tags
 *   - Squat-resistance: different caller + same urlHash → different id, no conflict
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { SourceRegistry } from "../../typechain-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Compute urlHash the same way the contract does: keccak256(toBytes(url)). */
function urlHash(url: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(url));
}

/** Standard valid author split: single author at 100%. */
function singleAuthor(wallet: string): { wallet: string; basisPoints: number }[] {
  return [{ wallet, basisPoints: 10_000 }];
}

/** Deploy a fresh SourceRegistry for each test suite. */
async function deployRegistry(): Promise<SourceRegistry> {
  const Factory = await ethers.getContractFactory("SourceRegistry");
  return (await Factory.deploy()) as SourceRegistry;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SourceRegistry", () => {
  let registry: SourceRegistry;
  let creator: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  beforeEach(async () => {
    [creator, other] = await ethers.getSigners() as [HardhatEthersSigner, HardhatEthersSigner];
    registry = await deployRegistry();
  });

  // ── register happy path ────────────────────────────────────────────────────

  it("registers a source and stores all fields correctly", async () => {
    const hash = urlHash("https://example.com/article");
    const tx = await registry.connect(creator).register(
      hash,
      creator.address,
      singleAuthor(creator.address),
      200n,            // $0.0002 fetch price
      "bafytest",
      "ai,research",
    );
    await tx.wait();

    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32"],
      [creator.address, hash],
    ));

    const record = await registry.get(id);
    expect(record.creator).to.equal(creator.address);
    expect(record.payoutWallet).to.equal(creator.address);
    expect(record.active).to.be.true;
    expect(record.fetchPriceUsdc6).to.equal(200n);
    expect(record.contentCid).to.equal("bafytest");
    expect(record.tags).to.equal("ai,research");
    expect(record.authors.length).to.equal(1);
    expect(record.authors[0].basisPoints).to.equal(10_000n);

    const count = await registry.sourceCount();
    expect(count).to.equal(1n);
  });

  // ── AlreadyExists ──────────────────────────────────────────────────────────

  it("reverts AlreadyExists when same caller registers the same urlHash twice", async () => {
    const hash = urlHash("https://example.com/dupe");
    await registry.connect(creator).register(
      hash, creator.address, singleAuthor(creator.address), 100n, "cid1", "",
    );

    await expect(
      registry.connect(creator).register(
        hash, creator.address, singleAuthor(creator.address), 100n, "cid2", "",
      ),
    ).to.be.revertedWithCustomError(registry, "AlreadyExists");
  });

  // ── NotCreator ─────────────────────────────────────────────────────────────

  it("reverts NotCreator when a non-creator calls update", async () => {
    const hash = urlHash("https://example.com/guarded");
    await registry.connect(creator).register(
      hash, creator.address, singleAuthor(creator.address), 100n, "cid", "",
    );
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32"],
      [creator.address, hash],
    ));

    await expect(
      registry.connect(other).update(
        id, other.address, singleAuthor(other.address), 200n, "newcid", "",
      ),
    ).to.be.revertedWithCustomError(registry, "NotCreator");
  });

  it("reverts NotCreator when a non-creator calls deactivate", async () => {
    const hash = urlHash("https://example.com/deact");
    await registry.connect(creator).register(
      hash, creator.address, singleAuthor(creator.address), 100n, "cid", "",
    );
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32"],
      [creator.address, hash],
    ));

    await expect(
      registry.connect(other).deactivate(id),
    ).to.be.revertedWithCustomError(registry, "NotCreator");
  });

  it("allows the creator to deactivate their own source", async () => {
    const hash = urlHash("https://example.com/selfdeact");
    await registry.connect(creator).register(
      hash, creator.address, singleAuthor(creator.address), 100n, "cid", "",
    );
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32"],
      [creator.address, hash],
    ));

    await registry.connect(creator).deactivate(id);
    const record = await registry.get(id);
    expect(record.active).to.be.false;
  });

  // ── BadSplit ───────────────────────────────────────────────────────────────

  it("reverts BadSplit when author bp do not sum to 10_000", async () => {
    const hash = urlHash("https://example.com/badsplit");
    const badAuthors = [
      { wallet: creator.address, basisPoints: 6_000 },
      { wallet: other.address, basisPoints: 3_000 }, // total = 9_000, not 10_000
    ];
    await expect(
      registry.connect(creator).register(hash, creator.address, badAuthors, 100n, "cid", ""),
    ).to.be.revertedWithCustomError(registry, "BadSplit");
  });

  it("reverts BadSplit when an author has zero basis points", async () => {
    const hash = urlHash("https://example.com/zerobp");
    const zeroAuthors = [
      { wallet: creator.address, basisPoints: 10_000 },
      { wallet: other.address, basisPoints: 0 }, // zero-bp author
    ];
    await expect(
      registry.connect(creator).register(hash, creator.address, zeroAuthors, 100n, "cid", ""),
    ).to.be.revertedWithCustomError(registry, "BadSplit");
  });

  it("reverts BadSplit when the authors array is empty", async () => {
    const hash = urlHash("https://example.com/noauthors");
    await expect(
      registry.connect(creator).register(hash, creator.address, [], 100n, "cid", ""),
    ).to.be.revertedWithCustomError(registry, "BadSplit");
  });

  // ── ZeroAddress ────────────────────────────────────────────────────────────

  it("reverts ZeroAddress when payoutWallet is the zero address", async () => {
    const hash = urlHash("https://example.com/zeropayout");
    await expect(
      registry.connect(creator).register(
        hash, ethers.ZeroAddress, singleAuthor(creator.address), 100n, "cid", "",
      ),
    ).to.be.revertedWithCustomError(registry, "ZeroAddress");
  });

  it("reverts ZeroAddress when an author wallet is the zero address", async () => {
    const hash = urlHash("https://example.com/zeroauthor");
    const zeroWallet = [{ wallet: ethers.ZeroAddress, basisPoints: 10_000 }];
    await expect(
      registry.connect(creator).register(hash, creator.address, zeroWallet, 100n, "cid", ""),
    ).to.be.revertedWithCustomError(registry, "ZeroAddress");
  });

  // ── StringTooLong ──────────────────────────────────────────────────────────

  it("reverts StringTooLong when contentCid exceeds 128 bytes", async () => {
    const hash = urlHash("https://example.com/longcid");
    const oversizedCid = "Q".repeat(129); // 129 bytes > 128 limit
    await expect(
      registry.connect(creator).register(
        hash, creator.address, singleAuthor(creator.address), 100n, oversizedCid, "",
      ),
    ).to.be.revertedWithCustomError(registry, "StringTooLong");
  });

  it("reverts StringTooLong when tags exceed 256 bytes", async () => {
    const hash = urlHash("https://example.com/longtags");
    const oversizedTags = "t".repeat(257); // 257 bytes > 256 limit
    await expect(
      registry.connect(creator).register(
        hash, creator.address, singleAuthor(creator.address), 100n, "cid", oversizedTags,
      ),
    ).to.be.revertedWithCustomError(registry, "StringTooLong");
  });

  it("accepts contentCid at exactly the 128-byte boundary", async () => {
    const hash = urlHash("https://example.com/exact128");
    const exactCid = "Q".repeat(128);
    await expect(
      registry.connect(creator).register(
        hash, creator.address, singleAuthor(creator.address), 100n, exactCid, "",
      ),
    ).to.not.be.reverted;
  });

  // ── Squat-resistance ───────────────────────────────────────────────────────

  it("assigns a different id when a different caller uses the same urlHash (squat-resistance)", async () => {
    const hash = urlHash("https://popular-article.com");

    // Creator registers first.
    await registry.connect(creator).register(
      hash, creator.address, singleAuthor(creator.address), 100n, "original", "",
    );

    // Attacker tries to register the same URL — gets a DIFFERENT id, no conflict.
    await expect(
      registry.connect(other).register(
        hash, other.address, singleAuthor(other.address), 100n, "squat", "",
      ),
    ).to.not.be.reverted;

    // Verify both ids are distinct.
    const creatorId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32"],
      [creator.address, hash],
    ));
    const otherId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32"],
      [other.address, hash],
    ));

    expect(creatorId).to.not.equal(otherId);

    // The creator's record is untouched.
    const creatorRecord = await registry.get(creatorId);
    expect(creatorRecord.creator).to.equal(creator.address);
    expect(creatorRecord.contentCid).to.equal("original");

    // The attacker's record has no bearing on the creator's id.
    const otherRecord = await registry.get(otherId);
    expect(otherRecord.creator).to.equal(other.address);
  });

  // ── Update ─────────────────────────────────────────────────────────────────

  it("allows the creator to update their source", async () => {
    const hash = urlHash("https://example.com/updateme");
    await registry.connect(creator).register(
      hash, creator.address, singleAuthor(creator.address), 100n, "old-cid", "tag1",
    );
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32"],
      [creator.address, hash],
    ));

    await registry.connect(creator).update(
      id, creator.address, singleAuthor(creator.address), 500n, "new-cid", "tag1,tag2",
    );
    const updated = await registry.get(id);
    expect(updated.contentCid).to.equal("new-cid");
    expect(updated.fetchPriceUsdc6).to.equal(500n);
    expect(updated.tags).to.equal("tag1,tag2");
  });

  // ── Multi-author split ─────────────────────────────────────────────────────

  it("accepts a valid two-author split summing to 10_000", async () => {
    const hash = urlHash("https://example.com/coauthored");
    const twoAuthors = [
      { wallet: creator.address, basisPoints: 7_000 },
      { wallet: other.address, basisPoints: 3_000 },
    ];
    await expect(
      registry.connect(creator).register(hash, creator.address, twoAuthors, 100n, "cid", ""),
    ).to.not.be.reverted;
  });
});
