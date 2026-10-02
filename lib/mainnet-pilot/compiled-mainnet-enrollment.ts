import { verifyPublicMainnetEnrollment, type VerifiedPublicMainnetEnrollment } from "./public-enrollment";

/** Next statically replaces these exact public references in the dedicated worker/client bundle.
 * These are deliberately reviewed public build artifacts, never environment keys or page messages.
 * A promoted bundle retains its original pins; changing hosts requires a fresh reviewed build.
 */
const buildJson = process.env.NEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_JSON;
const buildDigest = process.env.NEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_DIGEST;

export async function compiledMainnetEnrollment(origin: string): Promise<VerifiedPublicMainnetEnrollment> {
  try {
    if (!buildJson || !buildDigest || buildJson.length > 65536) throw new Error();
    return await verifyPublicMainnetEnrollment(JSON.parse(buildJson), buildDigest, origin);
  } catch { throw new Error("mainnet browser enrollment unavailable"); }
}
