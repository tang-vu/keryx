/** Public proof string; publishing it proves feed control, never wallet authorization. */
export function verificationToken(wallet: string): string {
  return `keryx-verify:${wallet.toLowerCase()}`;
}
