import { describe, expect, it, vi } from "vitest";
import { createConfig, createConnector, createStorage, http, serialize, type CreateConnectorFn } from "wagmi";
import { connect, disconnect, reconnect } from "wagmi/actions";
import { arcTestnet } from "./chains";
import { deferredWalletConnector, walletRestoreHints } from "./deferred-wallet-connector";

const address = "0x1111111111111111111111111111111111111111" as const;
function fixture(initial: Record<string, unknown> = {}, failure = { provider: false }, initialAuthorized = true) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [`wagmi.${key}`, serialize(value)]));
  const calls = { provider: vi.fn(), setup: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
  let authorized = initialAuthorized;
  const provider = {};
  const factory: CreateConnectorFn = createConnector(config => ({
    id: "remote", name: "Remote", type: "remote",
    async setup() { calls.setup(this); await this.getProvider(); },
    async getProvider() { calls.provider(); if (failure.provider) throw new Error("Provider unavailable"); return provider; },
    async isAuthorized() { await this.getProvider(); return authorized; },
    async connect(parameters) {
      calls.connect(parameters, this);
      return { accounts: (parameters?.withCapabilities ? [{ address, capabilities: {} }] : [address]) as never, chainId: arcTestnet.id };
    },
    async disconnect() { authorized = false; calls.disconnect(); },
    async getAccounts() { return [address]; }, async getChainId() { return arcTestnet.id; },
    onAccountsChanged(accounts) { config.emitter.emit("change", { accounts: accounts as typeof address[] }); },
    onChainChanged(chain) { config.emitter.emit("change", { chainId: Number(chain) }); },
    onDisconnect() { config.emitter.emit("disconnect"); },
  }));
  const storage = createStorage({ storage: { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } } });
  const config = createConfig({ chains: [arcTestnet], connectors: [deferredWalletConnector(factory)], storage,
    ssr: true, multiInjectedProviderDiscovery: false, transports: { [arcTestnet.id]: http() } });
  return { config, connector: config.connectors[0], calls, storage };
}

describe("deferred remote wallet connectors", () => {
  it("does not initialize a new visitor's SDK during real wagmi reconnect", async () => {
    const { config, connector, calls } = fixture();
    await connector.setup?.();
    expect(await reconnect(config)).toEqual([]);
    expect(await connector.isAuthorized()).toBe(false);
    expect(calls.provider).not.toHaveBeenCalled(); expect(calls.setup).not.toHaveBeenCalled();
  });
  it("initializes once on explicit selection and preserves live connector context, capabilities and events", async () => {
    const { config, connector, calls } = fixture();
    const result = await connect(config, { connector, chainId: arcTestnet.id, withCapabilities: true });
    expect(result.accounts).toEqual([{ address, capabilities: {} }]);
    expect(calls.setup).toHaveBeenCalledTimes(1); expect(calls.setup.mock.calls[0][0]).toBe(connector);
    expect(calls.connect.mock.calls[0][1]).toBe(connector);
    expect(calls.connect.mock.calls[0][0]).toMatchObject({ chainId: arcTestnet.id, withCapabilities: true });
    connector.onAccountsChanged(["0x2222222222222222222222222222222222222222"]);
    expect(config.state.connections.get(connector.uid)?.accounts[0]).toBe("0x2222222222222222222222222222222222222222");
    await disconnect(config, { connector }); expect(calls.disconnect).toHaveBeenCalledOnce();
    expect(config.state.status).toBe("disconnected");
  });
  it.each([
    { recentConnectorId: "remote" },
    { recentConnectorId: "another", store: { state: { connections: new Map([["old-uid", { connector: { id: "remote" } }]]) } } },
  ])("restores remembered SDKs including a non-current saved connection", async initial => {
    const { config, connector, calls } = fixture(initial);
    await connector.setup?.();
    expect(await reconnect(config)).toHaveLength(1);
    expect(calls.setup).toHaveBeenCalledTimes(1);
    expect(calls.connect.mock.calls[0][0]).toMatchObject({ isReconnecting: true });
    connector.onDisconnect(); expect(config.state.status).toBe("disconnected");
  });
  it("contains automatic setup failure and allows a later explicit retry", async () => {
    const failure = { provider: true };
    const { config, connector, calls } = fixture({ recentConnectorId: "remote" }, failure);
    await expect(connector.setup?.()).resolves.toBeUndefined();
    await expect(connect(config, { connector })).rejects.toThrow("Provider unavailable");
    expect(calls.connect).not.toHaveBeenCalled();
    failure.provider = false;
    await connect(config, { connector }); expect(calls.setup).toHaveBeenCalledTimes(1);
  });
  it("does not treat a persisted hint as wallet authorization", async () => {
    const { config, connector, calls } = fixture({ recentConnectorId: "remote" }, { provider: false }, false);
    await connector.setup?.();
    expect(await reconnect(config)).toEqual([]);
    expect(calls.provider).toHaveBeenCalled(); expect(calls.connect).not.toHaveBeenCalled();
    expect(config.state.status).toBe("disconnected");
  });
  it("does not lose explicit selection while restore hints resolve", async () => {
    const { config, connector, calls } = fixture();
    await Promise.all([connector.setup?.(), connect(config, { connector })]);
    expect(calls.setup).toHaveBeenCalledTimes(1); expect(calls.connect).toHaveBeenCalledTimes(1);
  });
  it("uses only bounded connector identifiers from persisted hints", () => {
    expect([...walletRestoreHints(null, { state: { connections: "invalid" } })]).toEqual([]);
    expect([...walletRestoreHints("remote", null)]).toEqual(["remote"]);
    expect([...walletRestoreHints("x".repeat(129), { state: { connections: new Map([["a", { connector: { id: 1 } }]]) } })]).toEqual([]);
  });
});
