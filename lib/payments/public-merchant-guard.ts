import { NextResponse } from "next/server";
import { z } from "zod";
import { config } from "../config";
import { addressSchema } from "../buyer/protocol";

/** Reserved addresses survive merchant rotation; never derive this set from a request or DB nonce row. */
export function reservedResearchMerchants(value: unknown, publicPayee: unknown): ReadonlySet<string> {
  const raw = z.string().max(2048).parse(value === undefined ? "" : value).trim();
  if (!raw) return new Set();
  const addresses = z.array(addressSchema).min(1).max(32).parse(raw.split(",").map(item => item.trim()));
  const reserved = new Set(addresses.map(item => item.toLowerCase()));
  if (reserved.has(addressSchema.parse(publicPayee).toLowerCase())) throw new Error("Research merchant collision");
  return reserved;
}

/** Public sellers only: no caller-controlled flag, resource URL or metadata can bypass this gate. */
export function guardPublicMerchant(payTo: unknown, authorization?: { to: unknown }): NextResponse | null {
  let reserved: ReadonlySet<string>;
  try { reserved = reservedResearchMerchants(config.privateResearchReservedPayees, config.sellerAddress); }
  catch { return NextResponse.json({ error: "Payment merchant policy unavailable" }, { status: 503 }); }
  // Do not rely on an external verifier's coercion of malformed address aliases when
  // purpose separation is active. Quotes omit this envelope; paid requests always supply it.
  if (reserved.size > 0 && authorization && !addressSchema.safeParse(authorization.to).success) {
    return NextResponse.json({ error: "Invalid authorization recipient" }, { status: 400 });
  }
  if ([payTo, authorization?.to].some(address => typeof address === "string" && reserved.has(address.trim().toLowerCase()))) {
    return NextResponse.json({ error: "Reserved research merchant is unavailable on public endpoints" }, { status: 403 });
  }
  return null;
}
