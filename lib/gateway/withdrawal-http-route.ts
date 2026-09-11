import { config } from "../config";
import { accountSessionContext } from "../account-sessions";
import { createConfiguredWithdrawalHttpService } from "./withdrawal-http-service";
import { createWithdrawalStatusHandler } from "./withdrawal-status-handler";
import { createWithdrawalMintReader } from "./withdrawal-mint-reader";

type Operation = "prepare" | "submit" | "status";

/** App-owned runtime binding. Recovery deliberately does not construct the signer
 * or require creation caps/enablement. A configured but unreadable mint journal
 * remains unavailable rather than silently downgrading evidence to not-checked. */
export async function withdrawalHttpRoute(operation: Operation, request: Request): Promise<Response> {
  let response: Response;
  try {
    if (config.networkId !== "eip155:5042002" || config.cctpDomain !== 26) throw new Error();
    if (operation === "status") {
      const directory = process.env.KERYX_WITHDRAWAL_RELAY_DIRECTORY;
      response = await createWithdrawalStatusHandler(accountSessionContext,
        directory ? createWithdrawalMintReader(directory) : undefined)(request);
    } else {
      const service = createConfiguredWithdrawalHttpService(process.env, config);
      response = service ? await service[operation](request)
        : Response.json({ error: "New withdrawals are unavailable. Use recovery for existing requests." }, { status: 503 });
    }
  } catch { response = Response.json({ error: "Withdrawal service is temporarily unavailable. Retain your original request." }, { status: 503 }); }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Vary", "Cookie, Origin");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
