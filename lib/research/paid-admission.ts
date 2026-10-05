import { configuredResearchAllowance } from "./research-allowance";

/** New paid admission pauses while finite browser compute is active. Changed/expired controls
 * also fail closed. Original authenticated status/delivery paths must run before this guard. */
export function paidResearchAdmissionResponse(): Response | null {
  try { if (!configuredResearchAllowance()) return null; } catch { /* Do not expose protected policy details. */ }
  return Response.json({ error: "research_service_unavailable",
    message: "Paid research admission is temporarily paused. Keep original payment and recovery records; existing results remain recoverable." },
  { status: 503, headers: { "Cache-Control": "no-store" } });
}
