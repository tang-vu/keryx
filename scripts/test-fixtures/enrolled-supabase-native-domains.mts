/** TEST ONLY. Called by the owned, fresh PostgreSQL17/PostgREST harness.
 * The parent installs identity/schema, activates floor3, pins the native localhost
 * registry BEFORE module/factory import, and supplies its public registry bindings.
 * No raw SQL/client, resolver injection, mock RPC, environment, or runtime discovery.
 * Synthetic signatures/reservations are not funded settlement or production readiness.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { encodeFunctionResult } from 'viem';
import { REGISTRY_ABI } from '../../lib/registry/registry-abi.ts';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';
import type { KeryxDB } from '../../lib/db/keryx-db.ts';
import type { StorageIdentity } from '../../lib/db/storage-identity.ts';
import type { BrowserQueryPolicy } from '../../lib/payments/browser-query-policy.ts';
import type { BrowserSourceOriginalAdmission } from '../../lib/db/browser-signing-originals.ts';

export interface NativeDomainRegistryFixture {
  /** Public creator/payout returned by the parent's fixed native registry server. */
  readonly creator: Address;
  readonly payout: Address;
}

/** Fixed native HTTP fixture; no application/config imports before parent pinning. */
export async function startEnrolledSupabaseNativeRegistry() {
  const creator = privateKeyToAccount(generatePrivateKey()).address;
  const payout = `0x${'22'.repeat(20)}` as Address;
  const registryContract = `0x${'33'.repeat(20)}` as Address;
  let failed = false;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST');
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        assert.ok(Buffer.byteLength(body) <= 16384);
      }
      const input = JSON.parse(body);
      assert.equal(input.jsonrpc, '2.0');
      assert.ok(Number.isSafeInteger(input.id));
      let result: unknown;
      if (input.method === 'eth_chainId') result = '0x4cef52';
      else if (input.method === 'eth_getBlockByNumber') result = {
        number: '0x1', hash: `0x${'77'.repeat(32)}`,
        timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
      };
      else {
        assert.equal(input.method, 'eth_call');
        assert.equal(input.params[0].to.toLowerCase(), registryContract);
        result = encodeFunctionResult({ abi: REGISTRY_ABI, functionName: 'get', result: {
          creator, payoutWallet: payout, authors: [], fetchPriceUsdc6: BigInt(1000),
          contentCid: '', tags: '', active: true,
        } });
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }));
    } catch {
      failed = true;
      response.writeHead(400).end('fixture-refused');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return Object.freeze({ rpcUrl: `http://127.0.0.1:${address.port}`, registryContract, creator, payout,
    assertHealthy: () => assert.equal(failed, false, 'Native registry fixture refused'),
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(new Error('Native registry cleanup failed')) : resolve());
      server.closeIdleConnections();
    }),
  });
}

export async function exerciseEnrolledSupabaseNativeDomains(
  db: KeryxDB,
  expectedIdentity: Readonly<StorageIdentity>,
  registry: Readonly<NativeDomainRegistryFixture>,
): Promise<readonly string[]> {
  const { assertEnrolledSupabaseAuthority } = await import('../../lib/db/enrolled-supabase-adapter.ts');
  const { validateStorageIdentity } = await import('../../lib/db/storage-identity.ts');
  const { canonicalJson } = await import('../../lib/canonical-json.ts');
  const deployment = await assertEnrolledSupabaseAuthority(db, 'write');
  const identity = validateStorageIdentity(expectedIdentity);
  assert.equal(identity.authorityMode, 'testnet-real');
  assert.equal(canonicalJson(deployment.identity), canonicalJson(identity));
  assert.match(registry.creator, /^0x[0-9a-fA-F]{40}$/u);
  assert.match(registry.payout, /^0x[0-9a-fA-F]{40}$/u);

  const owner = privateKeyToAccount(generatePrivateKey());
  const signer = privateKeyToAccount(generatePrivateKey());
  const sessionId = owner.address.toLowerCase();
  const grantEpoch = randomUUID();
  const queryId = randomUUID();
  const sourceId = `native-source-${randomUUID()}`;
  const itemId = `native-item-${randomUUID()}`;
  const sourceUrl = 'https://source.example/';
  const sourceName = 'Native synthetic source';
  const { browserSourceRegistryId } = await import('../../lib/payments/browser-original-source-context.ts');
  const { sourceItemContentVersion } = await import('../../lib/sources/source-item-asset.ts');
  const { browserQueryPolicyTypedData } = await import('../../lib/payments/browser-query-policy.ts');
  const { browserSigningTypedData, serializeBrowserSigningHeader, verifyBrowserSigningHeader } =
    await import('../../lib/payments/browser-signing-original.ts');
  const network = 'eip155:5042002';
  const token = '0x3600000000000000000000000000000000000000';
  const gateway = '0x0077777d7eba4688bdef3e311b846f25870a19b9';
  const payee = registry.payout.toLowerCase();
  await db.activateBrowserJournal();
  await db.upsertSessionGrant({ sessionId, sessAddr: signer.address, ownerAddr: owner.address,
    cap: 1, expiry: Date.now() + 120000, txHash: 'synthetic-native-unfunded', grantEpoch });
  await db.upsertSource({ id: sourceId, name: sourceName, url: sourceUrl, description: 'Synthetic native fixture',
    walletAddress: payee, fetchPrice: 0.001, tags: [], authors: [], createdAt: new Date().toISOString(),
    active: true, verified: true, onchainId: browserSourceRegistryId(registry.creator, sourceUrl) });
  await db.addItems([{ id: itemId, sourceId, title: 'Fixture item', summary: 'Preview',
    content: 'Synthetic body', link: 'https://source.example/item' }]);
  const item = await db.getItem(sourceId, itemId);
  assert.ok(item);
  const contentVersion = sourceItemContentVersion(item);
  const policy: BrowserQueryPolicy = { protocol: 'durable-v2', service: 'https://keryx.cc',
    owner: owner.address, signer: signer.address, grantEpoch, queryId,
    policyId: `0x${'44'.repeat(32)}`, requestNonce: `0x${'55'.repeat(32)}`,
    questionDigest: `0x${'66'.repeat(32)}`, queryCeilingMicros: '2000', lifetimeCeilingMicros: '4000',
    jobLimit: 2, expiresAt: Date.now() + 60000 };
  const proof = { policy, signature: await owner.signTypedData(browserQueryPolicyTypedData(policy)) };
  const query = await db.admitBrowserQueryPolicy(proof, sessionId);
  assert.equal(query.status, 'admitted');
  if (query.status !== 'admitted') throw new Error('Synthetic query refused');
  assert.deepEqual(await db.admitBrowserQueryPolicy(proof, sessionId), query);
  const requestId = randomUUID();
  const input: BrowserSourceOriginalAdmission = { protocol: 'durable-v3', queryNamespace: query.namespace, queryId,
    source: { sourceId, itemId, contentVersion, offerId: null },
    journal: { sessionId, requestId, queryId, grantEpoch, signer: signer.address, network, token,
      gatewayContract: gateway, sourceId, offerId: null, kind: 'fetch', payee, amountMicroUsdc: 1000,
      requirements: { scheme: 'exact', network, asset: token, amount: '1000', payTo: payee,
        maxTimeoutSeconds: 691200, extra: { name: 'GatewayWalletBatched', version: '1', verifyingContract: gateway } },
      payment: { kind: 'fetch', queryId, sourceId, sourceName, payer: signer.address, payee,
        amountUsdc: 0.001, network, grantEpoch, itemId, contentVersion } } };
  const admission = await db.admitBrowserSourceSigningOriginal(input);
  assert.equal(admission.status, 'admitted');
  if (admission.status !== 'admitted') throw new Error('Synthetic original refused');
  assert.equal(admission.original.protocol, 'durable-v3');
  assert.deepEqual(await db.admitBrowserSourceSigningOriginal(input), admission);
  assert.equal(await db.readExposedBrowserSigningSnapshotForSigner(signer.address, sessionId, requestId), null);
  assert.equal(await db.exposeBrowserJournal(sessionId, requestId), true);
  const header = serializeBrowserSigningHeader(admission.original,
    await signer.signTypedData(browserSigningTypedData(admission.original)));
  await verifyBrowserSigningHeader(admission.original, header);
  assert.equal(await db.signBrowserSigningOriginal(sessionId, requestId, header), true);
  const snapshot = await db.readBrowserSigningSnapshot(owner.address, sessionId, requestId);
  assert.ok(snapshot);
  assert.equal(snapshot.journal.phase, 'signed');
  assert.equal(snapshot.query.spentMicros, '1000');
  assert.equal(snapshot.signerSpentMicros, '1000');
  assert.equal(snapshot.retainedEpochSpentMicros, '1000');
  assert.deepEqual(snapshot.original, admission.original);
  assert.equal(await db.signBrowserSigningOriginal(sessionId, requestId, header), true);
  assert.deepEqual(await db.readBrowserSigningSnapshot(owner.address, sessionId, requestId), snapshot);
  assert.equal(await db.readExposedBrowserSigningSnapshotForSigner(owner.address, sessionId, requestId), null);
  assert.equal(await db.browserSignerConfirmedSpendMicro(signer.address), 0);
  // Exposure is irreversible: cancellation cannot refund an already handed-out nonce.
  assert.equal(await db.cancelPreparedBrowserJournal(sessionId, requestId), false);
  assert.equal((await db.getSessionGrant(sessionId))?.spent, 0.001);

  const changed = structuredClone(input);
  changed.source.contentVersion = 'changed-version';
  const conflicting = await db.admitBrowserSourceSigningOriginal(changed);
  assert.equal(conflicting.status, 'refused');
  assert.deepEqual(await db.readBrowserSigningSnapshot(owner.address, sessionId, requestId), snapshot);
  const foreignHeader = serializeBrowserSigningHeader(admission.original,
    await owner.signTypedData(browserSigningTypedData(admission.original)));
  await assert.rejects(() => db.signBrowserSigningOriginal(sessionId, requestId, foreignHeader));
  assert.deepEqual(await db.readBrowserSigningSnapshot(owner.address, sessionId, requestId), snapshot);

  const now = Date.now();
  const challenge = createHash('sha256').update(randomUUID()).digest('hex');
  await db.createAuthChallenge(challenge, now, now + 60000);
  assert.equal(await db.consumeAuthChallenge(challenge, now), true);
  assert.equal(await db.consumeAuthChallenge(challenge, now), false);
  const sessionHash = createHash('sha256').update(randomUUID()).digest('hex');
  const webSession = { hash: sessionHash, wallet: owner.address.toLowerCase(), issuedAt: now, expiresAt: now + 60000 };
  await db.createWebSession(webSession);
  assert.deepEqual(await db.getWebSession(sessionHash), webSession);
  await db.revokeWebSession(sessionHash, signer.address);
  assert.deepEqual(await db.getWebSession(sessionHash), webSession);
  await db.revokeWebSession(sessionHash, owner.address);
  assert.equal(await db.getWebSession(sessionHash), null);

  const { createPrivateAuthorization } = await import('../../lib/buyer/private-request-commitment.ts');
  const { preparePrivateResearchIntent } = await import('../../lib/a2a/private-research-intent.ts');
  const { buyerTypedData } = await import('../../lib/buyer/protocol.ts');
  const merchants = { privatePayee: `0x${'ab'.repeat(20)}`, publicResearchPayee: `0x${'cd'.repeat(20)}` };
  const requirement = { scheme: 'exact', network, asset: token, amount: '50000', payTo: merchants.privatePayee,
    maxTimeoutSeconds: 604860, extra: { name: 'GatewayWalletBatched', version: '1', verifyingContract: gateway } };
  async function privateIntent() {
    const request = { question: `Synthetic private question ${randomUUID()}`, budget: 0.03,
      researchMode: 'quick', packageVersion: '1.0.0', responseMode: 'async', access: 'payer-private-v1', model: null };
    const draft = await createPrivateAuthorization(request, requirement, owner.address, merchants, Date.now());
    const intent = await preparePrivateResearchIntent({ request: draft.request, salt: draft.salt,
      payment: { authorization: draft.authorization, signature: await owner.signTypedData(buyerTypedData(draft.authorization)) } }, requirement, merchants);
    assert.deepEqual(await db.reservePrivateResearchIntent(intent), intent);
    assert.deepEqual(await db.reservePrivateResearchIntent(intent), intent);
    assert.deepEqual(await db.getPrivateResearchIntent(intent.id, owner.address), intent);
    assert.equal(await db.getPrivateResearchIntent(intent.id, signer.address), null);
    return intent;
  }
  const intents = [await privateIntent(), await privateIntent(), await privateIntent()];
  const treasury = { signer: signer.address, capacityMicros: '60000' };
  assert.equal(await db.reservePrivateTreasury(intents[0].id, owner.address, treasury), true);
  assert.equal(await db.reservePrivateTreasury(intents[0].id, owner.address, treasury), true);
  const competing = await Promise.all(intents.slice(1).map(intent => db.reservePrivateTreasury(intent.id, owner.address, treasury)));
  assert.deepEqual(competing.sort(), [false, true]);
  assert.deepEqual(await db.getPrivateTreasury(intents[0].id, owner.address), { signer: signer.address.toLowerCase(), amountMicros: '30000' });
  await assert.rejects(() => db.reservePrivateTreasury(intents[0].id, owner.address, { ...treasury, capacityMicros: '60001' }));
  assert.deepEqual(await db.getPrivateTreasurySummary(signer.address), { capacityMicros: '60000', allocatedMicros: '60000',
    unallocatedMicros: '0', committedMicros: '0', confirmedMicros: '0', unresolvedOrProcessingMicros: '0',
    conservativeBackingMicros: '60000', observation: 'database-recorded', chainFinalityVerified: false });
  const after = await assertEnrolledSupabaseAuthority(db, 'write');
  assert.equal(canonicalJson(after.identity), canonicalJson(identity));
  assert.equal(await db.submitBrowserJournal(sessionId, requestId), true);
  const submitted = await db.readBrowserSigningSnapshot(owner.address, sessionId, requestId);
  assert.equal(submitted?.journal.phase, 'submission_attempted');
  assert.ok(admission.journal.payment.id);
  const wrongNonce = `0x${'99'.repeat(32)}`;
  assert.equal((await db.failPendingPayment(admission.journal.payment.id, wrongNonce, 'synthetic-terminal')).resolved, false);
  assert.deepEqual(await db.readBrowserSigningSnapshot(owner.address, sessionId, requestId), submitted);
  assert.equal((await db.failPendingPayment(admission.journal.payment.id, admission.journal.nonce, 'synthetic-terminal')).resolved, true);
  const failed = await db.readBrowserSigningSnapshot(owner.address, sessionId, requestId);
  assert.equal(failed?.journal.phase, 'failed');
  assert.equal(failed?.query.spentMicros, '1000');
  assert.equal(await db.browserSignerConfirmedSpendMicro(signer.address), 0);
  await db.failPendingPayment(admission.journal.payment.id, admission.journal.nonce, 'synthetic-terminal');
  assert.deepEqual(await db.readBrowserSigningSnapshot(owner.address, sessionId, requestId), failed);
  return Object.freeze(['native-browser-v3-header-replay-and-synthetic-failure-callback', 'native-auth-challenge-session',
    'native-private-intent-and-treasury-cap-race']);
}
