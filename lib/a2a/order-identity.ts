/** Exact v2 hash preimage, shared by server and browser; changing it breaks recovery. */
export function a2aOrderIdentity(input: {
  network: string; payer: string; payee: string; authorizationId: string;
}): string {
  return ["keryx-a2a-v2", input.network, input.payer.toLowerCase(),
    input.payee.toLowerCase(), input.authorizationId.toLowerCase()].join("|");
}
