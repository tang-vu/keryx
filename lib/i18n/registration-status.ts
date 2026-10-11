import type { RegistrationPhase } from "@/lib/sources/registration-status";
import { createMessages } from "./messages";

const copy = createMessages("en");

/** English presentation of existing phases; no registration or indexing authority. */
export const registrationTitles: Record<RegistrationPhase, string> = {
  offline: copy("registrationStatus.offline"),
  signing: copy("registrationStatus.signing"),
  mining: copy("registrationStatus.mining"),
  indexing: copy("registrationStatus.indexing"),
  indexed: copy("registrationStatus.indexed"),
  failed: copy("registrationStatus.failed"),
  unknown: copy("registrationStatus.unknown"),
};
