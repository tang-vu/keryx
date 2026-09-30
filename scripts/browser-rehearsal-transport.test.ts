import { expect, it, vi } from "vitest";
import { browserRehearsalTransport } from "./browser-rehearsal-transport";

it("loses the real paid response, forbids a second paid HTTP and forces no redirects", async () => {
  const original = vi.fn<typeof fetch>().mockResolvedValue(new Response("synthetic unfunded receipt"));
  const transport = browserRehearsalTransport("https://synthetic.example/api/source/one", original);
  const options = { headers: { "payment-signature": "unfunded synthetic bearer" } };
  await expect(transport.fetchImpl("https://other.example", options)).rejects.toThrow("refuses");
  expect(original).not.toHaveBeenCalled();
  await expect(transport.fetchImpl("https://synthetic.example/api/source/one", options)).rejects.toThrow("response loss");
  expect(transport.summary()).toEqual({ paidCalls: 1, responseObserved: true });
  expect(original.mock.calls[0][1]?.redirect).toBe("error");
  await expect(transport.fetchImpl("https://synthetic.example/api/source/one", options)).rejects.toThrow("refuses");
  expect(original).toHaveBeenCalledTimes(1);
});

it("does not pretend a transport failure was a completed response-loss injection", async () => {
  const original = vi.fn<typeof fetch>().mockRejectedValue(new Error("synthetic timeout"));
  const transport = browserRehearsalTransport("https://synthetic.example", original);
  await expect(transport.fetchImpl("https://synthetic.example", { headers: { "payment-signature": "synthetic" } })).rejects.toThrow("timeout");
  expect(transport.summary()).toEqual({ paidCalls: 1, responseObserved: false });
});
