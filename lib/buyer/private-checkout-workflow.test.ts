import { mkdtemp, readdir, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { checkoutPrivateBuyer } from "./private-checkout-workflow";
import { createPrivateQuote } from "../a2a/private-quote";
import { readPrivateBuyerJournal } from "./private-journal";
import { BUYER_NETWORK, BUYER_USDC, BUYER_GATEWAY } from "./protocol";

it.each(["available", "unavailable", "changed-policy", "lost-response"] as const)("composes fresh checkout safely: %s", async mode => {
  const root = await mkdtemp(join(tmpdir(), "keryx-checkout-workflow-")), state = join(root, "journal");
  const eoa = privateKeyToAccount(generatePrivateKey());
  const account = { address: eoa.address, signMessage: vi.fn(eoa.signMessage), signTypedData: vi.fn(eoa.signTypedData) };
  const merchants = { privatePayee: `0x${"2".repeat(40)}`, publicResearchPayee: `0x${"3".repeat(40)}` };
  const request = { question: "Synthetic private checkout question", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async",
    access: "payer-private-v1", model: "deepseek-flash", reasoning: { modelId: "deepseek-flash", provider: "deepseek",
      wireModel: "deepseek-v4-flash", endpoint: "https://synthetic.example/v1/chat/completions", fallback: "local-heuristic", redirects: "prohibited" } };
  const quote = createPrivateQuote({ question: request.question, budget: request.budget, researchMode: request.researchMode,
    packageVersion: request.packageVersion, responseMode: request.responseMode }, {
    provider: { modelId: "deepseek-flash", provider: "deepseek", baseUrl: "https://synthetic.example/v1", apiKey: "synthetic" }, merchants,
    requirement: { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: merchants.privatePayee,
      maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } } });
  if (mode === "changed-policy") quote.request.question = "Synthetic server replacement";
  let submissions = 0, signedOut = false;
  const http = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.redirect).toBe("error");
    if (url.endsWith("/api/auth/nonce")) return Response.json({ nonce: "syntheticNonce12345" });
    if (url.endsWith("/api/auth/verify")) return Response.json({ ok: true }, { headers: { "set-cookie": "keryx_session=synthetic.cookie; HttpOnly" } });
    if (url.endsWith("/api/auth/signout")) { signedOut = true; return Response.json({ ok: true }); }
    expect(init?.headers).toMatchObject({ cookie: "keryx_session=synthetic.cookie" });
    if (url.endsWith("/api/me/private-jobs/quote")) return Response.json({ wallet: eoa.address, purchasingAvailable: mode !== "unavailable", quote });
    expect(url).toBe("https://keryx.cc/api/agent/private-ask"); submissions++;
    const saved = await readPrivateBuyerJournal(state, eoa.address, merchants);
    expect(JSON.parse(String(init?.body))).toEqual(saved.submission);
    expect(await readdir(state)).toContain("private-submission-attempt.json");
    if (mode === "lost-response") throw new Error("Synthetic response loss");
    return Response.json({ id: saved.id, paymentStatus: "pending" }, { status: 202 });
  });
  const run = () => checkoutPrivateBuyer(state, request, merchants, { maxTotalMicros: "50000", maxServiceFeeMicros: "20000" }, account, http);
  try {
    if (mode === "changed-policy") await expect(run()).rejects.toThrow("Private account operation unavailable");
    else {
      const result = await run();
      expect(result.status).toBe(mode === "unavailable" ? "checkout-unavailable" : mode === "lost-response" ? "recovery-required" : "response-received");
      expect(result.signOutConfirmed).toBe(true);
      expect(JSON.stringify(result)).not.toContain(request.question);
    }
    expect(signedOut).toBe(true);
    const attempted = mode === "available" || mode === "lost-response";
    expect(account.signTypedData).toHaveBeenCalledTimes(attempted ? 1 : 0);
    expect(submissions).toBe(attempted ? 1 : 0);
    if (attempted) {
      const calls = http.mock.calls.length;
      await expect(run()).rejects.toThrow("new state directory");
      expect(http).toHaveBeenCalledTimes(calls);
      expect(account.signTypedData).toHaveBeenCalledTimes(1);
    } else expect(await readdir(root)).toEqual([]);
  } finally {
    for (const name of await readdir(state).catch(() => [])) await unlink(join(state, name));
    await rmdir(state).catch(() => undefined); await rmdir(root);
  }
});
