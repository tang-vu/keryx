/** TEST ONLY signer-owned popup bridge. Parent messages never configure the worker. */
declare global {
  interface Window {
    fixtureParentOrigin: string;
    fixtureAddress?: string;
    fixtureConfigured: boolean;
    fixtureTelemetry?: {
      attempted: boolean;
      busy: boolean;
      readSignatures: number;
      paymentSignatures: number;
      callbackFetchStarts: number;
      producedPaymentSignatures: number;
    };
    fixtureConfigure: (binding: Record<string, string>) => void;
    fixtureRestart: () => void;
    fixtureRejected: number;
  }
}
const opener = window.opener;
const parentOrigin = window.fixtureParentOrigin;
const records = new Set<string>();
window.fixtureConfigured = false;
window.fixtureRejected = 0;
let worker: Worker;
function start() {
  window.fixtureAddress = undefined;
  window.fixtureConfigured = false;
  window.fixtureTelemetry = undefined;
  worker = new Worker("/worker.js");
  worker.onmessage = (event) => {
    const value = event.data;
    if (value.type === "ready") window.fixtureAddress = value.address;
    if (value.type === "configured") window.fixtureConfigured = true;
    if (value.type === "telemetry") window.fixtureTelemetry = value;
    if (value.type === "status" && records.has(value.correlationId)) {
      opener?.postMessage(
        {
          version: "1",
          correlationId: value.correlationId,
          status: value.status,
        },
        parentOrigin
      );
    }
  };
}
start();
// Trusted Playwright instrumentation on signer origin only. Public bindings, no secret/tuple.
window.fixtureConfigure = (binding) =>
  worker.postMessage({ command: "configure", binding });
window.fixtureRestart = () => {
  worker.terminate();
  start();
};
window.addEventListener("message", (event) => {
  const data = event.data;
  if (
    event.origin !== parentOrigin ||
    event.source !== opener ||
    event.ports.length ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).sort().join(",") !== "command,correlationId,version" ||
    data.version !== "1" ||
    data.command !== "sign-original" ||
    typeof data.correlationId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(data.correlationId) ||
    records.has(data.correlationId) ||
    records.size >= 8
  ) {
    window.fixtureRejected++;
    return;
  }
  records.add(data.correlationId);
  worker.postMessage({ command: "sign", correlationId: data.correlationId });
});
export {};
