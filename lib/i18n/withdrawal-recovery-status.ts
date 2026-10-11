import { createMessages } from "./messages";

const copy = createMessages("en");
const recoveryMessages = {
  attestation: {
    "not-checked": copy("withdrawalRecoveryStatus.attestation.unchecked"),
    "not-queued": copy("withdrawalRecoveryStatus.attestation.notQueued"),
    queued: copy("withdrawalRecoveryStatus.attestation.queued"),
    prepared: copy("withdrawalRecoveryStatus.attestation.prepared"),
    unknown: copy("withdrawalRecoveryStatus.attestation.unknown"),
  },
  transferPending: {
    "not-checked": copy("withdrawalRecoveryStatus.transferPending.unchecked"),
    "not-queued": copy("withdrawalRecoveryStatus.transferPending.notQueued"),
    queued: copy("withdrawalRecoveryStatus.transferPending.queued"),
    prepared: copy("withdrawalRecoveryStatus.transferPending.prepared"),
    unknown: copy("withdrawalRecoveryStatus.transferPending.unknown"),
  },
  request: {
    "not-checked": copy("withdrawalRecoveryStatus.request.unchecked"),
    "not-queued": copy("withdrawalRecoveryStatus.request.notQueued"),
    queued: copy("withdrawalRecoveryStatus.request.queued"),
    prepared: copy("withdrawalRecoveryStatus.request.prepared"),
    unknown: copy("withdrawalRecoveryStatus.request.unknown"),
  },
} as const;

/** Complete English status messages; preserves the original fallback and empty mint output. */
export function withdrawalRecoveryStatusCopy(progress: { status: string; mintStatus: string }): string {
  const messages = progress.status === "attestation-stored" ? recoveryMessages.attestation
    : progress.status === "awaiting-transfer-evidence" ? recoveryMessages.transferPending : recoveryMessages.request;
  return Object.hasOwn(messages, progress.mintStatus)
    ? messages[progress.mintStatus as keyof typeof messages] : messages.unknown;
}
