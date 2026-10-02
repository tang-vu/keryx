import { afterEach, expect, it, vi } from 'vitest';
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from '../../lib/arc-network-profile';
import type { KeryxDB } from '../../lib/db/keryx-db';

const setup = vi.hoisted(() => ({ config: { profile: null as unknown, networkId: '', sellerAddress: '0x1111111111111111111111111111111111111111',
  privateResearchReservedPayees: 'reserved', funderKey: 'legacy-unavailable' }, custody: vi.fn(), account: vi.fn(), policy: vi.fn() }));
vi.mock('../../lib/config', () => ({ config: setup.config }));
vi.mock('../../lib/payments/mainnet-hosted-gateway', () => ({ assertMainnetHostedCustodyReady: setup.custody }));
vi.mock('viem/accounts', () => ({ privateKeyToAccount: setup.account }));
vi.mock('../../lib/a2a/private-runtime-policy', () => ({ privateRuntimePolicy: setup.policy }));
const db = Object.freeze({}) as KeryxDB;
afterEach(() => vi.resetAllMocks());
async function mainnet() {
  setup.config.profile = ARC_MAINNET_PROFILE; setup.config.networkId = ARC_MAINNET_PROFILE.networkId;
  setup.config.funderKey = 'legacy-unavailable';
  setup.custody.mockImplementation(async (_db, role) => ({ signer: role === 'public' ? 'public-mainnet' : 'private-mainnet' }));
  setup.policy.mockReturnValue({ accepted: true });
  return (await import('./private-operations-inspect-context.mts')).privateInspectionPolicy;
}
it('inspects mainnet sealed public/private custody without loading legacy signer keys', async () => {
  const inspect = await mainnet();
  expect(await inspect(db, { KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: 'reserved' })).toEqual({ accepted: true });
  expect(setup.custody.mock.calls).toEqual([[db, 'public'], [db, 'private']]);
  expect(setup.account).not.toHaveBeenCalled();
  expect(setup.policy.mock.calls[0][1]).toEqual({ network: 'eip155:5042', publicSeller: setup.config.sellerAddress,
    publicTreasurySigners: ['public-mainnet'], privateTreasurySigner: 'private-mainnet' });
});
it('refuses unavailable dedicated mainnet custody without falling back to legacy keys or observations', async () => {
  const inspect = await mainnet(); setup.custody.mockRejectedValue(new Error('Dedicated custody unavailable'));
  await expect(inspect(db, { KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: 'reserved', KERYX_PRIVATE_TREASURY_PRIVATE_KEY: `0x${'11'.repeat(32)}` })).rejects.toThrow();
  expect(setup.account).not.toHaveBeenCalled(); expect(setup.policy).not.toHaveBeenCalled();
});
it('refuses a reserved-policy mismatch before reading either custody role', async () => {
  const inspect = await mainnet();
  await expect(inspect(db, { KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: 'foreign' })).rejects.toThrow();
  expect(setup.custody).not.toHaveBeenCalled(); expect(setup.account).not.toHaveBeenCalled();
});
it('retains the explicit testnet inspection path and its original two custody accounts', async () => {
  const inspect = await mainnet(); setup.config.profile = ARC_TESTNET_PROFILE; setup.config.networkId = ARC_TESTNET_PROFILE.networkId;
  setup.config.funderKey = `0x${'22'.repeat(32)}`;
  setup.account.mockImplementation(key => ({ address: key === setup.config.funderKey ? 'public-testnet' : 'private-testnet' }));
  await inspect(db, { KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: 'reserved', KERYX_PRIVATE_TREASURY_PRIVATE_KEY: `0x${'11'.repeat(32)}` });
  expect(setup.custody).not.toHaveBeenCalled(); expect(setup.account).toHaveBeenCalledTimes(2);
  expect(setup.policy.mock.calls[0][1]).toMatchObject({ network: 'eip155:5042002', publicTreasurySigners: ['public-testnet'], privateTreasurySigner: 'private-testnet' });
});
