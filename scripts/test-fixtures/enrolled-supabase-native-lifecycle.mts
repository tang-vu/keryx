/** Lifecycle of the fixture-only RPC executor. The parent owns removal even if
 * Docker creates the container but its launch command later reports failure. */
type OwnedDocker = (args: string[], input?: string, timeout?: number) => string;

function curlName(postgresContainer: string): string {
  if (!/^keryx-enrolled-reference-[a-f0-9-]+$/.test(postgresContainer)) {
    throw new Error("Owned native fixture name refused");
  }
  return `${postgresContainer}-curl`;
}

export function launchOwnedSupabaseCurl(
  postgresContainer: string, ownContainer: (name: string) => void, docker: OwnedDocker,
): void {
  const name = curlName(postgresContainer);
  ownContainer(name);
  // The 20-minute job and all child/request deadlines stay unchanged. This
  // bounded executor must survive the entire suite, then parent finally removes it.
  docker(["run", "-d", "--name", name, "--network", `container:${postgresContainer}`, "--memory", "64m",
    "--entrypoint", "sh", "curlimages/curl:8.12.1", "-c", "sleep 1800"]);
}

export function describeOwnedSupabaseCurlState(postgresContainer: string, docker: OwnedDocker): string {
  try {
    // Never inspect environment, mounts, configuration, provider bodies or auth.
    const state = docker(["inspect", "--format",
      "{{.State.Running}} {{.State.ExitCode}} {{.State.OOMKilled}} {{.State.StartedAt}} {{.State.FinishedAt}}",
      curlName(postgresContainer)], undefined, 2000).trim();
    const timestamp = "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z";
    const match = new RegExp(`^(true|false) (-?[0-9]{1,3}) (true|false) (${timestamp}) (${timestamp})$`).exec(state);
    return match ? `running=${match[1]} exitCode=${match[2]} oomKilled=${match[3]} startedAt=${match[4]} finishedAt=${match[5]}`
      : "unavailable";
  } catch { return "unavailable"; }
}
