import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { parsePublicMainnetEnrollment, type PublicMainnetEnrollment } from "./public-enrollment";
export type PilotPolicy = PublicMainnetEnrollment;

export function pinPilotPolicy(input: unknown): { policy: PilotPolicy; digest: string; wire: string } {
  const policy = parsePublicMainnetEnrollment(input);
  const wire = canonicalJson(policy);
  return { policy, wire, digest: createHash("sha256").update(wire).digest("hex") };
}
