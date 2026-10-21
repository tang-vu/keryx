import { MAX_PROCUREMENT_BYTES } from "./contracts";
import { buildEvidenceProcurement } from "./engine";
import { exportEvidenceProcurement, procurementReceiptFormat, type ProcurementReceiptFormat } from "./export";
import { readBoundedRequestJson } from "../read-bounded-request-json";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization, Cookie",
  "X-Content-Type-Options": "nosniff",
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: privateHeaders });

/** Authenticate before touching private bytes. Transformation never resolves
 * URLs, invokes providers, stores the packet, or creates financial authority. */
export function createEvidenceProcurementRoute(authorize: (request: Request) => Promise<Response | null>) {
  return async (request: Request) => {
    let format: ProcurementReceiptFormat;
    try {
      const parameters = new URL(request.url).searchParams;
      if ([...parameters.keys()].some(key => key !== "format") || parameters.getAll("format").length > 1)
        throw new Error("Invalid selector");
      format = procurementReceiptFormat(parameters.get("format") ?? undefined);
    } catch { return json({ error: "invalid_evidence_procurement_request" }, 400); }
    try {
      const denied = await authorize(request);
      if (denied) {
        for (const [name, value] of Object.entries(privateHeaders)) denied.headers.set(name, value);
        return denied;
      }
    } catch { return json({ error: "procurement_authentication_unavailable" }, 503); }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
      return json({ error: "invalid_evidence_procurement_request" }, 400);
    try {
      const packet = await readBoundedRequestJson(request, MAX_PROCUREMENT_BYTES);
      if (format === "json") return json({ procurement: await buildEvidenceProcurement(packet) });
      const receipt = await exportEvidenceProcurement(packet, format);
      return new Response(receipt.text, { headers: { ...privateHeaders, "Content-Type": receipt.contentType,
        "Content-Disposition": `attachment; filename="private-evidence-procurement-receipt.${receipt.extension}"` } });
    } catch { return json({ error: "invalid_evidence_procurement" }, 400); }
  };
}
