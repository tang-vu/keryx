/** Manual candidate only. No ENV/custody/DB/app imports, install, role changes or marker writes. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createMaintenanceFrontDoor } from "../lib/maintenance/front-door.ts";
import { readWindowControl } from "../lib/maintenance/planned-window.ts";

export async function start(args: string[]) {
  if (process.platform !== "linux") throw Error("Linux protected-control profile required");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 24 || major === 24 && minor < 16) throw Error("Node24.16 or newer required");
  if (args.length !== 6 || args[0] !== "--control-directory" || args[2] !== "--listen-port" || args[4] !== "--upstream-port")
    throw Error("Usage: maintenance-front-door --control-directory ABSOLUTE_PRIVATE_DIR --listen-port PORT --upstream-port PORT");
  const [directory, port, upstreamPort] = [args[1], Number(args[3]), Number(args[5])];
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === upstreamPort) throw Error("Invalid listen port");
  if (readWindowControl(directory).kind === "unavailable") throw Error("Maintenance control unavailable");
  // Recovery forwarding is intentionally absent from this launcher pending root/peer integration.
  const running = createMaintenanceFrontDoor({ upstreamPort, readControl: () => readWindowControl(directory) });
  await new Promise<void>((accept, reject) => { running.server.once("error", reject); running.server.listen(port, "127.0.0.1", accept); });
  const stop = () => { void running.close().then(() => { process.exitCode = 0; }).catch(() => { console.error("Maintenance front-door drain failed; retain process and evidence"); }); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  return running;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await start(process.argv.slice(2));
