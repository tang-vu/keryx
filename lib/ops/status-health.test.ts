import { expect, it, vi } from "vitest";
import { readStatusHealth } from "./status-health";

const NOW = Date.parse("2026-11-09T04:00:00Z");
const health = () => ({ name: "keryx", ok: true, db: "ok", status: "operational", commit: null,
  uptimeSeconds: 0, reasoning: "unconfigured", settles: "offline", network: "arcTestnet", rpcProvider: "Custom Arc RPC",
  time: new Date(NOW).toISOString(), monitoring: { state: "incomplete", checks: [] } });
const read = (value: unknown) => readStatusHealth(Response.json(value), () => NOW);

it.each(["operational", "degraded"])("preserves current %s health and independent optional sections", async status => {
  const value = { ...health(), status, registry: null, traction: { totalQueries: 3 } };
  expect(await read(value)).toEqual(value);
});
it.each([null, false, [], "keryx"])("refuses a non-record payload %j", async value => { expect(await read(value)).toBeNull(); });
it.each([
  ["name", "foreign"], ["ok", "true"], ["ok", false], ["db", "unreachable"], ["status", undefined], ["status", "unknown"],
  ["time", 1], ["time", "invalid"], ["uptimeSeconds", -1], ["uptimeSeconds", 1.5], ["uptimeSeconds", null],
  ["commit", 123], ["reasoning", null], ["settles", false], ["network", {}], ["rpcProvider", ""], ["reasoning", "x".repeat(129)],
])("refuses invalid readiness/display scalar %s=%j", async (key, value) => {
  expect(await read({ ...health(), [key as string]: value })).toBeNull();
});
it.each(["name", "ok", "db", "status", "time", "uptimeSeconds", "commit", "reasoning", "settles", "network", "rpcProvider"])("requires %s", async key => {
  const value: Record<string, unknown> = health(); delete value[key]; expect(await read(value)).toBeNull();
});
it.each([-120_000, 60_000])("accepts the freshness boundary %d", async offset => {
  expect(await read({ ...health(), time: new Date(NOW + offset).toISOString() })).not.toBeNull();
});
it.each([-120_001, 60_001])("refuses outside the freshness boundary %d", async offset => {
  expect(await read({ ...health(), time: new Date(NOW + offset).toISOString() })).toBeNull();
});
it("checks freshness after body consumption", async () => {
  let now = NOW; const bytes = new TextEncoder().encode(JSON.stringify(health()));
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(bytes); now += 120_001; controller.close(); } });
  expect(await readStatusHealth(new Response(stream), () => now)).toBeNull();
});
it.each([201, 203, 302, 403, 503])("refuses HTTP%d before acquiring a body reader", async status => {
  const cancel = vi.fn(); const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(health()))); }, cancel });
  const response = new Response(stream, { status }), getReader = vi.spyOn(stream, "getReader");
  expect(await readStatusHealth(response, () => NOW)).toBeNull(); expect(getReader).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
});
it("refuses redirected and missing-body observations", async () => {
  const response = Response.json(health()); Object.defineProperty(response, "redirected", { value: true });
  expect(await readStatusHealth(response, () => NOW)).toBeNull();
  expect(await readStatusHealth(new Response(null), () => NOW)).toBeNull();
});
it("accepts the exact32KiB byte cap and cancels an oversized open stream", async () => {
  const plain = { ...health(), padding: "" }, size = new TextEncoder().encode(JSON.stringify(plain)).length;
  const value = { ...plain, padding: "x".repeat(32_768 - size) }; expect(await read(value)).toEqual(value);
  const cancel = vi.fn(), stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(32_769)); }, cancel });
  expect(await readStatusHealth(new Response(stream), () => NOW)).toBeNull(); expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false);
});
it("refuses invalid JSON/UTF8 and aborted streams without exposing their errors", async () => {
  expect(await readStatusHealth(new Response('{PRIVATE invalid'), () => NOW)).toBeNull();
  expect(await readStatusHealth(new Response(Uint8Array.of(0xff)), () => NOW)).toBeNull();
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new DOMException("PRIVATE aborted", "AbortError")); } });
  expect(await readStatusHealth(new Response(stream), () => NOW)).toBeNull(); expect(stream.locked).toBe(false);
});
it("refuses an invalid local clock", async () => { expect(await readStatusHealth(Response.json(health()), () => Number.NaN)).toBeNull(); });
it("keeps an HTTP refusal when unread body cancellation fails", async () => {
  const stream = new ReadableStream<Uint8Array>({ cancel() { throw new Error("PRIVATE cancel failure"); } });
  expect(await readStatusHealth(new Response(stream, { status: 503 }), () => NOW)).toBeNull();
});
