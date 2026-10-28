import { SiweMessage } from "siwe";

interface BrowserSignInMessage {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

/** Keep the original serializer and validation behind the browser's sign-in action. */
export function prepareBrowserSignInMessage(fields: BrowserSignInMessage): string {
  return new SiweMessage({
    ...fields,
    // ASCII only: this is the existing EIP-4361 statement, not new consent text.
    statement: "Sign in to Keryx. Citations are currency.",
    version: "1",
  }).prepareMessage();
}
