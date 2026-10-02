import { expect,it } from "vitest";
import { recordedArcLabel,recordedArcTransactionUrl,recordedGatewayProfiles } from "./arc-network-display";
it("keeps original mainnet/testnet references and never links Circle IDs or unknown networks",()=>{
  const hash=`0x${"ab".repeat(32)}`;
  expect(recordedArcTransactionUrl("eip155:5042",hash)).toBe(`https://explorer.arc.io/tx/${hash}`);
  expect(recordedArcTransactionUrl("eip155:5042002",hash)).toBe(`https://testnet.arcscan.app/tx/${hash}`);
  expect(recordedArcTransactionUrl(undefined,hash)).toBe(`https://testnet.arcscan.app/tx/${hash}`);
  expect(recordedArcTransactionUrl("eip155:1",hash)).toBeUndefined();expect(recordedArcTransactionUrl("eip155:5042","circle-id")).toBeUndefined();
  expect(recordedArcLabel("eip155:1")).toBe("unknown network");
  expect(recordedGatewayProfiles([{network:"eip155:5042"},{network:"eip155:5042002"},{network:"eip155:5042"},{network:"foreign"}]).map(p=>p.chainId)).toEqual([5042,5042002]);
});
