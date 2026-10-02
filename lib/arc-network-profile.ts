/** Immutable public network pins, safe in workers. Trusted deployment configuration selects
 * one canonical profile; neither requests nor payment requirements can select a network.
 */
export const ARC_TESTNET_PROFILE = Object.freeze({
  name: "arcTestnet",
  label: "Arc Testnet",
  chainId: 5042002,
  chainIdHex: "0x4cef52",
  networkId: "eip155:5042002",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
  rpcUrl: "https://rpc.testnet.arc.network",
  rpcWsUrl: "wss://rpc.testnet.arc.network",
  explorerUrl: "https://testnet.arcscan.app",
  gatewayApiUrl: "https://gateway-api-testnet.circle.com",
  cctpDomain: 26,
  erc20Decimals: 6,
  nativeDecimals: 18,
  testnet: true,
} as const);

/** Official reference values; observed code presence alone is not contract authenticity.
 * Sources: docs.arc.io/arc/references/connect-to-arc and contract-addresses;
 * developers.circle.com/gateway/references/contract-addresses and supported-blockchains.
 * Revalidate these against the intended deployment before a separately reviewed cutover.
 */
export const ARC_MAINNET_PROFILE = Object.freeze({
  name: "arc",
  label: "Arc",
  chainId: 5042,
  chainIdHex: "0x13b2",
  networkId: "eip155:5042",
  usdcAddress: "0x3600000000000000000000000000000000000000",
  gatewayWallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE",
  gatewayMinter: "0x2222222d7164433c4C09B0b0D809a9b52C04C205",
  rpcUrl: "https://rpc.blockdaemon.mainnet.arc.io",
  explorerUrl: "https://explorer.arc.io",
  gatewayApiUrl: "https://gateway-api.circle.com",
  cctpDomain: 26,
  erc20Decimals: 6,
  nativeDecimals: 18,
  testnet: false,
} as const);

export type ArcNetworkProfile = typeof ARC_TESTNET_PROFILE | typeof ARC_MAINNET_PROFILE;

export function paymentRuntimeProfile(network?: string): ArcNetworkProfile {
  if (network === undefined || network === ARC_TESTNET_PROFILE.name) return ARC_TESTNET_PROFILE;
  if (network === ARC_MAINNET_PROFILE.name) return ARC_MAINNET_PROFILE;
  throw new Error("KERYX_NETWORK must be arc or arcTestnet");
}

/** Trusted server/public build twins only. Existing unspecified deployments remain testnet.
 * This selects source capability, never authorizes deployment, enrollment or real spending.
 */
export function configuredPaymentProfile(serverNetwork?: string, publicBuildNetwork?: string): ArcNetworkProfile {
  const server = paymentRuntimeProfile(serverNetwork), browser = paymentRuntimeProfile(publicBuildNetwork);
  if (server !== browser) throw new Error("KERYX_NETWORK and NEXT_PUBLIC_KERYX_NETWORK must match");
  return server;
}

/** Mainnet payout authority must be pinned identically in server and public build. Testnet
 * retains its historical private-only configuration/default to preserve deployed behavior.
 */
export function configuredRegistryAddress(profile: ArcNetworkProfile, serverAddress?: string, publicAddress?: string): `0x${string}` {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) throw new Error("untrusted Arc registry profile");
  if (profile === ARC_MAINNET_PROFILE && (!serverAddress || !publicAddress ||
    !/^0x[0-9a-f]{40}$/i.test(serverAddress) || /^0x0{40}$/i.test(serverAddress) ||
    serverAddress.toLowerCase() !== publicAddress.toLowerCase()))
    throw new Error("mainnet server and public registry pins must match a nonzero address");
  return (publicAddress ?? serverAddress ?? `0x${"0".repeat(40)}`) as `0x${string}`;
}
