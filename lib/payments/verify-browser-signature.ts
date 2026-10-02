import { isAddress, recoverTypedDataAddress } from "viem";
import type { PendingSignatureChallenge } from "./pending-signatures";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";

// This route serves Arc testnet only. These values are independent of the returned header.
const MIN_TIMEOUT = 604900;
const MAX_TIMEOUT = 691200;

interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

function decimal(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
}

function sameAddress(left: unknown, right: unknown): boolean {
  return typeof left === "string" && typeof right === "string" &&
    isAddress(left) && isAddress(right) && left.toLowerCase() === right.toLowerCase();
}

/** Verify against the original durable challenge and admitted nonce before metadata acknowledgement.
 * Recovery may explicitly anchor to admission with bounded initial signing latency.
 * Submission verification uses current time and zero signing slack by default.
 * Legacy standalone verification fixtures may omit the nonce pin; live callbacks always supply it. */
export async function verifyBrowserSignature(
  header: string,
  challenge: PendingSignatureChallenge,
  nowSeconds = Math.floor(Date.now() / 1000),
  originalSigningSlackSeconds: 0 | 300 = 0,
  profile: ArcNetworkProfile = ARC_TESTNET_PROFILE,
): Promise<Authorization> {
  if (profile !== ARC_TESTNET_PROFILE && profile !== ARC_MAINNET_PROFILE) throw new Error("Unsupported browser signature profile");
  const req = challenge.requirements;
  if (req.scheme !== "exact" || req.network !== profile.networkId || !sameAddress(req.asset, profile.usdcAddress) ||
      !sameAddress(req.extra?.verifyingContract ?? "", profile.gatewayWallet) ||
      req.extra?.name !== "GatewayWalletBatched" || req.extra.version !== "1" ||
      !Number.isInteger(req.maxTimeoutSeconds) || req.maxTimeoutSeconds < MIN_TIMEOUT ||
      req.maxTimeoutSeconds > MAX_TIMEOUT || !isAddress(req.payTo) ||
      !decimal(req.amount) || BigInt(req.amount) <= BigInt(0) || !isAddress(challenge.expectedSigner)) {
    throw new Error("invalid original browser payment challenge");
  }

  // The HTTP header is bounded, canonical base64 JSON. Parsing never interprets a second payload.
  if (header.length === 0 || header.length > 4096 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(header)) {
    throw new Error("invalid payment header encoding");
  }
  const bytes = Buffer.from(header, "base64");
  if (bytes.length > 3072 || bytes.toString("base64") !== header) {
    throw new Error("invalid payment header encoding");
  }

  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("invalid payment header JSON"); }
  if (!parsed || typeof parsed !== "object") throw new Error("invalid payment header body");
  // The seller selects `.payload` when present. Accept only the browser's inner blob so the
  // authorization verified here is exactly the one later forwarded for settlement.
  if (Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "authorization,signature") {
    throw new Error("ambiguous browser payment header");
  }
  const body = parsed as { signature?: unknown; authorization?: unknown };
  if (typeof body.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(body.signature) ||
      !body.authorization || typeof body.authorization !== "object") {
    throw new Error("invalid signed authorization");
  }
  if (Array.isArray(body.authorization) ||
      Object.keys(body.authorization).sort().join(",") !== "from,nonce,to,validAfter,validBefore,value") {
    throw new Error("ambiguous signed authorization");
  }
  const auth = body.authorization as Authorization;
  if (!sameAddress(auth.from, challenge.expectedSigner) || !sameAddress(auth.to, req.payTo) ||
      !decimal(auth.value) || auth.value !== req.amount ||
      !decimal(auth.validAfter) || !decimal(auth.validBefore) ||
      typeof auth.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) {
    throw new Error("signed authorization differs from challenge");
  }
  if (challenge.expectedNonce && auth.nonce.toLowerCase() !== challenge.expectedNonce.toLowerCase()) {
    throw new Error("signed nonce differs from admitted authorization");
  }
  const validAfter = BigInt(auth.validAfter);
  const validBefore = BigInt(auth.validBefore);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error("invalid browser challenge timestamp");
  }
  const now = BigInt(nowSeconds);
  if (validAfter > now + BigInt(originalSigningSlackSeconds) ||
      validAfter < now - BigInt(3600) || validBefore <= now || validBefore <= validAfter ||
      validBefore > now + BigInt(req.maxTimeoutSeconds + 300)) {
    throw new Error("signed authorization validity is outside the challenge bound");
  }

  const recovered = await recoverTypedDataAddress({
    domain: {
      name: "GatewayWalletBatched",
      version: "1",
      chainId: profile.chainId,
      verifyingContract: profile.gatewayWallet,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from as `0x${string}`,
      to: auth.to as `0x${string}`,
      value: BigInt(auth.value),
      validAfter,
      validBefore,
      nonce: auth.nonce as `0x${string}`,
    },
    signature: body.signature as `0x${string}`,
  });
  if (!sameAddress(recovered, challenge.expectedSigner)) {
    throw new Error("payment signature does not match captured session signer");
  }
  return auth;
}
