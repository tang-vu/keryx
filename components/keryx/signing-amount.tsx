import { formatSigningUsdc, recordedUsdcMicros } from "@/lib/i18n/format";
import { createMessages } from "@/lib/i18n/messages";

const copy = createMessages("en");

/** Verification details only. No formatted value is passed to a signer or action callback. */
export function SigningAmount({ micros }: { micros: unknown }) {
  const amount = formatSigningUsdc(micros);
  return <span className="break-words font-mono tabular-nums">{amount}
    {amount !== "Amount unavailable" && <small className="ml-2">{copy("signingAmount.exactDetails", { micros: String(micros) })}</small>}
  </span>;
}
export function SigningRecordedAmount({ value }: { value: unknown }) {
  return <SigningAmount micros={recordedUsdcMicros(value)} />;
}
