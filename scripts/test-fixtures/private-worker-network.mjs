// Preload for the isolated worker lifecycle test ONLY. Never load in an application.
import net from "node:net";
import tls from "node:tls";
let providerCalls = 0, balanceCalls = 0, forbiddenCalls = 0;
const send = status => process.send?.({ status, providerCalls, balanceCalls, forbiddenCalls });
const forbidden = () => { forbiddenCalls++; send("forbidden-network"); throw new Error("Test network forbidden"); };
net.connect = forbidden; net.createConnection = forbidden;
net.Socket.prototype.connect = forbidden; tls.connect = forbidden;
process.on("SIGTERM", () => queueMicrotask(() => send("shutdown-observed")));
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === "https://gateway-api-testnet.circle.com/v1/balances") {
    balanceCalls++;
    const body = JSON.parse(String(init?.body));
    if (body.token !== "USDC" || body.sources?.length !== 1 || body.sources[0].domain !== 26
      || body.sources[0].depositor.toLowerCase() !== process.env.KERYX_PRIVATE_TREASURY_ADDRESS.toLowerCase()) return forbidden();
    return Response.json({ token: "USDC", balances: [{ ...body.sources[0], balance: "1.000000" }] });
  }
  if (url === "https://synthetic.invalid/v1/chat/completions") {
    providerCalls++;
    if (providerCalls === 1 && process.env.KERYX_TEST_HOLD_PROVIDER === "1") {
      await new Promise(resolve => {
        const resume = message => {
          if (message?.status !== "resume-provider") return;
          process.off("message", resume); process.channel?.unref(); resolve();
        };
        process.on("message", resume);
        send("provider-held");
      });
    }
    // Exercise the real resilient engine's explicit local fallback, not a canned run.
    return new Response("{}", { status: 503 });
  }
  return forbidden();
};
process.on("exit", () => {
  process.stdout.write(JSON.stringify({ status: "test-network-summary", providerCalls, balanceCalls, forbiddenCalls }) + "\n");
});
send("network-guard-installed");
