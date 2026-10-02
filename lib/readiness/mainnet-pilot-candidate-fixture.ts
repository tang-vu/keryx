import type { MainnetPilotCandidate } from "./mainnet-pilot-candidate";

export function candidate(): MainnetPilotCandidate {
  return { schema: "keryx-mainnet-pilot-candidate-v1", releaseCommit: "a".repeat(40), deploymentId: "invited-arc-pilot",
    mainnetOrigin: "https://pilot.example.com", testnetOrigin: "https://testnet.example.com",
    mainnetStateRoot: "D:/isolated/mainnet", testnetStateRoot: "D:/retained/testnet",
    mainnetEnvironmentFile: "D:/isolated/mainnet/.env.pilot", testnetEnvironmentFile: "D:/retained/testnet/.env.testnet",
    invitedBuyerAddresses: [`0x${"11".repeat(20)}`], creatorPayoutAddresses: [`0x${"22".repeat(20)}`],
    retainedTestnetSignerAddresses: [`0x${"33".repeat(20)}`], limits: { totalMicroUsdc: "1000000", perBuyerMicroUsdc: "250000",
      perAskMicroUsdc: "50000", perPaymentMicroUsdc: "10000", maxAsks: 20 },
    rpcUrl: "https://rpc.blockdaemon.mainnet.arc.io", registryAddress: null, supportOwner: "pilot-owner" };
}
