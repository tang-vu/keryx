import { getLivePilotServerContext } from "./server-context";
import { handlePilotRequest } from "./handlers";

/** Factory admission precedes request parsing, authentication and authority imports. */
export async function pilotRoute(request: Request): Promise<Response> {
  try { return await handlePilotRequest(request, await getLivePilotServerContext()); }
  catch { return Response.json({ error: "mainnet_pilot_closed" }, { status: 503 }); }
}
export async function pilotSellerRoute(request: Request): Promise<Response> {
  try { return await (await getLivePilotServerContext()).seller(request); }
  catch { return Response.json({ error: "mainnet_pilot_closed" }, { status: 503 }); }
}
