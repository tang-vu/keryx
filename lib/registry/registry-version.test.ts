import { afterEach, expect, it, vi } from "vitest";
import { parseRegistryVersion, serverRegistryVersion } from "./registry-version";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("keeps the current registry version when both deployment values are absent", () => {
  expect(serverRegistryVersion(undefined, undefined)).toBe(1);
  expect(serverRegistryVersion("1", undefined)).toBe(1);
  expect(serverRegistryVersion(undefined, "1")).toBe(1);
});

it.each(["1", "2", "3"])("accepts only matching explicit deployment version %s", version => {
  expect(serverRegistryVersion(version, version)).toBe(Number(version));
});

it.each([["3", undefined], [undefined, "3"], ["2", "3"], ["1", "2"]])(
  "refuses server/browser version mismatch %s/%s", (privateValue, publicValue) => {
    expect(() => serverRegistryVersion(privateValue, publicValue)).toThrow("versions differ");
  },
);

it.each(["", "0", "4", "03", " 3", "3 ", "v3"])("refuses unsupported version %s", version => {
  expect(() => parseRegistryVersion(version)).toThrow("Unsupported registry version");
  expect(() => serverRegistryVersion(version, version)).toThrow("Unsupported registry version");
});

it("pins browser signing authority at module load and rechecks server twins at runtime", async () => {
  vi.stubEnv("KERYX_REGISTRY_VERSION", "3"); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_VERSION", "3");
  vi.resetModules();
  const { getBrowserRegistryVersion, getServerRegistryVersion } = await import("./registry-version");
  expect(getBrowserRegistryVersion()).toBe(3); expect(getServerRegistryVersion()).toBe(3);
  vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_VERSION", "2");
  expect(getBrowserRegistryVersion()).toBe(3);
  expect(() => getServerRegistryVersion()).toThrow("versions differ");
});
