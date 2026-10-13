import { parseAbi } from "viem";

export const researchMandateAbi = parseAbi([
  "function prepare((bytes32 requestId,bytes32 taskHash,bytes32 sourceId,bytes32 contentHash,bytes32 decisionHash,bytes32 category,address payee,uint128 amount,uint64 validUntil) purchase) returns (bytes32 nonce)",
  "function pay(bytes32 requestId)",
  "function sync(bytes32 requestId)",
  "function release(bytes32 requestId)",
  "function transferDigest(bytes32 requestId) view returns (bytes32)",
  "function isValidSignature(bytes32 hash,bytes signature) view returns (bytes4)",
]);

export const purchaseComponents = [
  { name: "requestId", type: "bytes32" }, { name: "taskHash", type: "bytes32" },
  { name: "sourceId", type: "bytes32" }, { name: "contentHash", type: "bytes32" },
  { name: "decisionHash", type: "bytes32" }, { name: "category", type: "bytes32" },
  { name: "payee", type: "address" }, { name: "amount", type: "uint128" },
  { name: "validUntil", type: "uint64" },
] as const;
