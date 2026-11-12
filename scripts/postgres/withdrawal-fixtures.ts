/** Deterministic unfunded fixture wallets only. No custody file or network IO. */
import { randomUUID } from "node:crypto";
import { concatHex,encodePacked,keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE as profile } from "../../lib/arc-network-profile";
import { prepareWithdrawIntentForProfile } from "../../lib/gateway/withdraw-intent-core";
import { withdrawTypedData } from "../../lib/gateway/withdraw-protocol";
import { createWithdrawalRequest,type WithdrawalRequestRecord } from "../../lib/gateway/withdrawal-request";
const account=privateKeyToAccount(`0x${"33".repeat(32)}`),attester=privateKeyToAccount(`0x${"44".repeat(32)}`);
export async function nativeCreatorWithdrawalFixture(signer=account){
  const burnIntent={...prepareWithdrawIntentForProfile(profile,signer.address,"50000",signer.address,"100"),maxBlockHeight:"1100"};
  return createWithdrawalRequest({burnIntent,signature:await signer.signTypedData(withdrawTypedData(burnIntent))},
    {owner:signer.address,recipient:signer.address,domain:profile.cctpDomain,gatewayWallet:profile.gatewayWallet,gatewayMinter:profile.gatewayMinter,
      asset:profile.usdcAddress,maxValueMicros:"50000",maxFeeMicros:"100"},profile);
}
export async function nativeCreatorAttestationFixture(record:WithdrawalRequestRecord){
  const s=record.request.burnIntent.spec;
  const encoded=concatHex([encodePacked(["bytes4","uint32","uint32","uint32"],["0xca85def7",s.version,s.sourceDomain,s.destinationDomain]),
    s.sourceContract,s.destinationContract,s.sourceToken,s.destinationToken,s.sourceDepositor,s.destinationRecipient,s.sourceSigner,s.destinationCaller,
    encodePacked(["uint256","bytes32","uint32"],[BigInt(s.value),s.salt,0])]);
  const attestation=concatHex([encodePacked(["bytes4","uint256","uint32"],["0xff6fb334",BigInt(1200),340]),encoded]);
  return{transferId:randomUUID(),attestation,expirationBlock:"1200",signature:await attester.signMessage({message:{raw:keccak256(attestation)}})};
}
