import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "../storage-identity";

const state = vi.hoisted(() => ({ config: undefined as unknown, query: vi.fn(), end: vi.fn(), on: vi.fn() }));
vi.mock("pg", () => ({
  Pool: class {
    constructor(config: unknown) { state.config = config; }
    query(...args: unknown[]) { return state.query(...args); }
    end() { return state.end(); }
    on(...args: unknown[]) { state.on(...args); }
  },
  types: { getTypeParser: () => (value: string) => Number(value) },
}));
import { createPostgresBootstrapTransport, postgresPoolConfiguration, PostgresStorageBusy,
  PostgresStorageUnavailable, type PostgresConnectionOptions } from "./connection";

const options: PostgresConnectionOptions = {
  endpoint: { kind: "loopback", port: 5432 }, database: "synthetic", role: "synthetic_reader", password: "synthetic-not-a-live-secret",
};
const identity = (): StorageIdentity => ({ format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
  network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST,
  deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
  enrolledAt: "2026-11-11T00:00:00.000Z", provenanceDigest: "11".repeat(32) });
const response = (wire = '{"ready":true}', oid = 3802) => ({ rows: [[wire]], fields: [{ name: "result", dataTypeID: oid }] });

beforeEach(() => { vi.clearAllMocks(); state.config = undefined; state.end.mockResolvedValue(undefined); state.query.mockResolvedValue(response()); });

describe("explicit PostgreSQL connection", () => {
  it("pins local destination, pool, server deadlines and raw JSON despite ambient PG settings", () => {
    vi.stubEnv("PGHOST", "untrusted.invalid"); vi.stubEnv("PGDATABASE", "foreign");
    try {
      const config = postgresPoolConfiguration(options);
      expect(config.host).toBe("127.0.0.1"); expect(config.database).toBe("synthetic");
      expect(config.user).toBe("synthetic_reader"); expect(config.password).toBe(options.password);
      expect(config.max).toBe(2); expect(config.options).toContain("statement_timeout=5000");
      expect(config.types!.getTypeParser(3802, "text")('{"amount":"999999999999999999"}')).toBe('{"amount":"999999999999999999"}');
    } finally { vi.unstubAllEnvs(); }
  });
  it("accepts one explicit canonical Unix directory", () => {
    expect(postgresPoolConfiguration({ ...options, endpoint: { kind: "unix", directory: "/run/postgresql", port: 5432 } }).host).toBe("/run/postgresql");
  });
  it.each([
    { ...options, endpoint: { kind: "loopback", port: 0 } },
    { ...options, endpoint: { kind: "loopback", port: 5432, host: "foreign.invalid" } },
    { ...options, endpoint: { kind: "unix", directory: "/run/../postgresql", port: 5432 } },
    { ...options, endpoint: { kind: "unix", directory: "/run/postgresql/", port: 5432 } },
    { ...options, database: "database; DROP TABLE sources" },
    { ...options, role: "" }, { ...options, role: undefined }, { ...options, database: undefined },
    { ...options, password: "" }, { ...options, password: "synthetic\ncredential" },
  ])("refuses ambiguous destination/configuration before constructing a pool", bad => {
    expect(() => createPostgresBootstrapTransport(bad as PostgresConnectionOptions)).toThrow(PostgresStorageUnavailable);
    expect(state.config).toBeUndefined();
  });
});

describe("bounded fixed PostgreSQL bootstrap reads", () => {
  it("binds the complete identity and source contract as values, never SQL text", async () => {
    const transport = createPostgresBootstrapTransport(options), expected = identity();
    expect(await transport.read("authority", expected, "aa".repeat(32))).toEqual({ ready: true });
    const query = state.query.mock.calls[0][0];
    expect(query.text).toBe("SELECT keryx_pg.verify_runtime_authority($1::jsonb,$2::text) AS result");
    expect(JSON.parse(query.values[0])).toEqual(expected); expect(query.values[1]).toBe("aa".repeat(32));
    await transport.close();
  });
  it("rejects unknown operations and invalid identity/digest before native I/O", async () => {
    const transport = createPostgresBootstrapTransport(options);
    await expect(transport.read("constructor" as never, identity())).rejects.toThrow(PostgresStorageUnavailable);
    await expect(transport.read("identity", { ...identity(), network: "eip155:1" } as unknown as StorageIdentity)).rejects.toThrow(PostgresStorageUnavailable);
    await expect(transport.read("readiness", identity(), "foreign")).rejects.toThrow(PostgresStorageUnavailable);
    await expect(transport.read("identity", identity(), "aa".repeat(32))).rejects.toThrow(PostgresStorageUnavailable);
    expect(state.query).not.toHaveBeenCalled(); await transport.close();
  });
  it("bounds pending work and refuses overflow without submitting another query", async () => {
    let finish!: (value: unknown) => void;
    state.query.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const transport = createPostgresBootstrapTransport(options);
    const requests = Array.from({ length: 10 }, () => transport.read("identity", identity()));
    await expect(transport.read("identity", identity())).rejects.toThrow(PostgresStorageBusy);
    expect(state.query).toHaveBeenCalledTimes(10); finish(response()); await Promise.all(requests);
    await expect(transport.read("identity", identity())).resolves.toEqual({ ready: true }); await transport.close();
  });
  it("redacts native errors and performs no automatic retry", async () => {
    state.query.mockRejectedValue(new Error("private credential and raw database detail"));
    const transport = createPostgresBootstrapTransport(options);
    await expect(transport.read("identity", identity())).rejects.toThrow(/^PostgreSQL storage unavailable$/);
    expect(state.query).toHaveBeenCalledTimes(1); await transport.close();
  });
  it.each([
    { rows: [], fields: [{ name: "result", dataTypeID: 3802 }] },
    { rows: [["{}"], ["{}"]], fields: [{ name: "result", dataTypeID: 3802 }] },
    response("{}", 25), response("invalid-json"), response('"' + "x".repeat(4 * 1024 * 1024) + '"'),
    { rows: [[{}]], fields: [{ name: "result", dataTypeID: 3802 }] },
  ])("refuses malformed, oversized and drifted result envelopes", async bad => {
    state.query.mockResolvedValue(bad); const transport = createPostgresBootstrapTransport(options);
    await expect(transport.read("identity", identity())).rejects.toThrow(PostgresStorageUnavailable); await transport.close();
  });
  it("does not publish an in-flight result after terminal close", async () => {
    let finish!: (value: unknown) => void;
    state.query.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const transport = createPostgresBootstrapTransport(options), request = transport.read("identity", identity());
    const first = transport.close(); expect(transport.close()).toBe(first);
    expect(state.end).not.toHaveBeenCalled();
    finish(response()); await expect(request).rejects.toThrow(PostgresStorageUnavailable); await first;
    await expect(transport.read("identity", identity())).rejects.toThrow(PostgresStorageUnavailable);
    expect(state.end).toHaveBeenCalledTimes(1);
  });
});
