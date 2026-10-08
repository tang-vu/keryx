import type { CitedStatement } from "../agent/cited-statements";

// Isolated documentation-shaped test premises, never evidence for a real delivery.
export const qualityQuestion = "Can a citation-toll research business use Circle Gateway Nanopayments with ERC-1271 contract wallets on Arc mainnet? Explain the supported payment flow, current limitations, and concrete acceptance checks using primary documentation.";
export const qualityTargets = [
  "Does Circle Gateway Nanopayments/x402 batch settlement support ERC-1271 contract wallets for this citation-toll research business on Arc mainnet?",
  "What supported EOA Nanopayments payment flow takes the business from a Gateway deposit through buyer authorization, seller delivery and batched settlement?",
  "What standard Gateway transfer flow supports ERC-1271 contract wallets, and how does it differ from Nanopayments?",
  "What current authorization, revocation-timing and validation-trust limitations apply to the ERC-1271 Gateway alternative?",
  "What concrete acceptance checks should establish the correct Arc mainnet profile and wallet/payment rail, bounded authorization, genuine settlement and successful research delivery?",
];
const rows: Array<[number, string, string]> = [
  [0, "S2", "Gateway Nanopayments and x402 batch settlement require EOA signatures and do not support ERC-1271."],
  [1, "S2", "A buyer deposits USDC into a Gateway Wallet contract (one-time onchain transaction)."],
  [1, "S2", "A buyer requests a paid resource from a seller's API."],
  [1, "S2", "The seller responds with 402 Payment Required and payment details."],
  [1, "S2", "The buyer signs an EIP-3009 payment authorization (offchain, zero gas)."],
  [1, "S2", "The buyer retries the request with the signed authorization attached."],
  [1, "S2", "The seller verifies the signature and serves the resource immediately."],
  [1, "S2", "Gateway collects authorizations and settles them in batches onchain, crediting the seller's Gateway balance."],
  [2, "S1", "You submit a burn intent to the Gateway /v1/transfer endpoint with the contractSigner: true flag and the contract's signature."],
  [2, "S1", "The burn intent's sourceSigner is the address of the signing contract, and the signature is produced by that contract's ERC-1271 authorization logic."],
  [2, "S1", "When contractSigner is omitted or false, Gateway validates the signature as a standard EOA signature."],
  [2, "S1", "Gateway routes the request to a validation service, deployed as an AWS Nitro Enclave that validates the signature at request time."],
  [2, "S1", "The enclave queries multiple independent blockchain RPC providers and simulates the contract's isValidSignature response against a recent target block height."],
  [2, "S1", "If a quorum of RPCs (at least 2 of 3) agree that the signature is valid, the validation service signs off on the request and the Gateway API returns the attestation as usual."],
  [2, "S1", "When the attestation is used, Gateway performs the burn using the validation service's signature."],
  [2, "S1", "The Gateway Wallet contract recognizes the validation service signature and completes burns validated this way."],
  [2, "S1", "Nanopayment burn intents are batched and submitted through ERC-3009 requests, which use a different validation path."],
  [3, "S1", "EVM-only: ERC-1271 validation is supported only on EVM blockchains."],
  [3, "S1", "Read-only validation: The validation service simulates isValidSignature offchain, so authorization logic that modifies onchain state during validation isn't supported."],
  [3, "S1", "The validation service can validate signatures using blocks up to 5 minutes old."],
  [3, "S1", "This means that it may take up to 5 minutes for key rotation or revocation transactions to apply."],
  [3, "S1", "Gateway uses a quorum of multiple node operators on each request to mitigate incorrect responses, but Gateway can't guarantee that each RPC performed the validation correctly or that an RPC's network security wasn't compromised."],
  [3, "S1", "The enclave's signing key is protected by AWS Key Management Service (KMS) with attestation-based access policies."],
  [3, "S1", "Only the audited enclave image can access the key."],
  [3, "S1", "These attestations can be independently verified, providing transparency into the validation process."],
  [3, "S1", "Depositors using insecure ERC-1271 implementations can have their balances drained."],
  [4, "S3", "| Parameter | Value |\n| :- | :- |\n| Chain ID | `5042` |\n| Currency | USDC |\n| Explorer | [explorer.arc.io](https://explorer.arc.io) |"],
  [4, "S4", "| Blockchain | Domain | Mainnet | Testnet |\n| - | - | - | - |\n| Arc | 26 | `arc` | `arcTestnet` |"],
  [4, "S1", "Contracts that enforce allowlists, spending limits, or compliance checks before approving an action"],
];
export function qualityStatements(): CitedStatement[] {
  return rows.map(([claimIndex, marker, quote]) => ({ claimIndex, marker, quote,
    text: claimIndex === 4 && marker === "S3" ? "Arc mainnet uses chain 5042, currency USDC and explorer.arc.io." :
      claimIndex === 4 && marker === "S4" ? "Arc's Gateway domain is 26 with mainnet arc and testnet arcTestnet." :
        quote.endsWith(".") ? quote : `${quote}.` }));
}
