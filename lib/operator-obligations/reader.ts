export interface ObligationReader { wallet: string; role: "public" | "private" }

/** Protected server delegation only; never custody, payout, funding or signer authority.
 * Missing configuration stays disabled. No dev/profile role implicitly grants access. */
export function configuredObligationReader(env: Readonly<Record<string, string | undefined>> = process.env): ObligationReader | null {
  const wallet = env.KERYX_OPERATOR_OBLIGATION_READER, role = env.KERYX_OPERATOR_OBLIGATION_ROLE;
  if (!wallet || !/^0x[0-9a-f]{40}$/.test(wallet) || wallet === `0x${"0".repeat(40)}` || !["public", "private"].includes(role ?? "")) return null;
  return Object.freeze({ wallet, role: role as "public" | "private" });
}
export function isObligationReader(reader: ObligationReader | null, wallet: string | undefined, scopes: readonly string[] | undefined): boolean {
  return reader !== null && wallet === reader.wallet && scopes?.includes("operator:read") === true;
}
