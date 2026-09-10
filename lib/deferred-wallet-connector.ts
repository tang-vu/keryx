import type { CreateConnectorFn } from "wagmi";

/** Stored connector IDs are startup hints only, never account or payment authority. */
export function walletRestoreHints(recent: unknown, persisted: unknown): Set<string> {
  const ids = new Set<string>();
  if (typeof recent === "string" && recent.length <= 128) ids.add(recent);
  if (!persisted || typeof persisted !== "object" || !("state" in persisted)) return ids;
  const state = persisted.state;
  if (!state || typeof state !== "object" || !("connections" in state)) return ids;
  const connections = state.connections;
  if (!(connections instanceof Map) || connections.size > 100) return ids;
  for (const value of connections.values()) {
    if (!value || typeof value !== "object" || !("connector" in value)) continue;
    const connector = value.connector;
    if (connector && typeof connector === "object" && typeof connector.id === "string" && connector.id.length <= 128) ids.add(connector.id);
  }
  return ids;
}

/** Leave injected providers unchanged. Defer remote SDKs until restore or explicit selection. */
export function deferredWalletConnector(factory: CreateConnectorFn): CreateConnectorFn {
  return config => {
    const original = factory(config);
    let active = false;
    let hints: Promise<Set<string>> | undefined;
    let initialization: Promise<void> | undefined;
    const readHint = (key: string) => {
      // Capture storage synchronously: createConfig can write its initial empty state next.
      try { return Promise.resolve(config.storage?.getItem(key)).catch(() => null); }
      catch { return Promise.resolve(null); }
    };
    const shouldActivate = async () => {
      if (active) return true;
      hints ??= Promise.all([
        readHint("recentConnectorId"), readHint("store"),
      ]).then(([recent, persisted]) => walletRestoreHints(recent, persisted));
      if ((await hints).has(original.id)) active = true;
      return active; // Explicit selection may have happened while storage was being read.
    };
    const initialize = (context: ReturnType<CreateConnectorFn>) => {
      initialization ??= (async () => {
        // Some SDK setup implementations swallow provider errors. Do not cache failed setup.
        const provider = await original.getProvider.call(context);
        if (!provider) throw new Error("Wallet provider is unavailable");
        await original.setup?.call(context);
      })().catch(error => { initialization = undefined; throw error; });
      return initialization;
    };
    const connector: ReturnType<CreateConnectorFn> = {
      ...original,
      async setup() {
        // wagmi starts setup without awaiting it. Explicit connect still surfaces errors.
        if (await shouldActivate()) await initialize(this).catch(() => undefined);
      },
      async getProvider(parameters) {
        if (!await shouldActivate()) throw new Error("Select this wallet to initialize its provider");
        return original.getProvider.call(this, parameters);
      },
      async isAuthorized() {
        if (!await shouldActivate()) return false;
        return original.isAuthorized.call(this);
      },
      // Preserve the vendor's generic capability result and all original arguments.
      connect: (async function (this: ReturnType<CreateConnectorFn>, ...parameters: Parameters<typeof original.connect>) {
        active = true;
        await initialize(this);
        return Reflect.apply(original.connect, this, parameters);
      }) as typeof original.connect,
    };
    return connector;
  };
}
