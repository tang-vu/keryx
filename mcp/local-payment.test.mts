import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { payForResearch, readPending, recoverResearch } from "./local-payment.mts";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const payee = `0x${"2".repeat(40)}`;
const dirs: string[] = [];
const quote = Buffer.from(JSON.stringify({
  x402Version: 2,
  resource: { url: "https://example.test/api/agent/ask" },
  accepts: [{ scheme: "exact", network: "eip155:5042002",
    asset: "0x3600000000000000000000000000000000000000", amount: "80000", payTo: payee,
    maxTimeoutSeconds: 691200,
    extra: { name: "GatewayWalletBatched", version: "1",
      verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } }],
})).toString("base64");

afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it("retains a paid 500 receipt and blocks another debit until recovery", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-mcp-test-"));
  dirs.push(dir);
  const journalFile = path.join(dir, "payment.json");
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": quote } }))
    .mockImplementationOnce(async (_url, init) => {
      const submitted = JSON.parse(Buffer.from(init.headers["Payment-Signature"], "base64").toString("utf8"));
      expect(submitted).toMatchObject({
        x402Version: 2,
        resource: { url: "https://example.test/api/agent/ask" },
        accepted: { amount: "80000", payTo: payee, network: "eip155:5042002" },
        payload: { authorization: { from: account.address, to: payee, value: "80000" } },
      });
      expect(submitted.payload.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(submitted.payload.signature).toMatch(/^0x[0-9a-f]{130}$/i);
      expect(readPending(journalFile)?.status).toBe("submitted");
      const receipt = Buffer.from(JSON.stringify({ success: true, network: "eip155:5042002",
        payer: account.address, transaction: "circle-settlement" })).toString("base64");
      return Response.json({ error: "paid resource unavailable after settlement" },
        { status: 500, headers: { "PAYMENT-RESPONSE": receipt } });
    });
  const input = { url: "https://example.test/api/agent/ask", body: { question: "question", budget: 0.03 },
    account, journalFile, maxAmountUsdc: 1, fetchImpl: fetchImpl as typeof fetch };
  await expect(payForResearch(input)).rejects.toThrow(/Payment settled; HTTP 500/);
  expect(readPending(journalFile)).toMatchObject({ status: "settled", amountUsdc: "0.08", settlementId: "circle-settlement" });
  expect(JSON.parse(Buffer.from(readPending(journalFile)!.paymentResponse!, "base64").toString("utf8"))).toMatchObject({ transaction: "circle-settlement" });
  const queryId = readPending(journalFile)!.queryId;
  await expect(payForResearch(input)).rejects.toThrow(/previous payment may have settled/i);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  const poll = vi.fn().mockResolvedValue(Response.json({ status: "completed", answer: "saved answer" }));
  const recovered = await recoverResearch("https://example.test", journalFile, poll as typeof fetch);
  expect(recovered.data).toMatchObject({ answer: "saved answer" });
  expect(poll.mock.calls[0][0]).toBe(`https://example.test/api/agent/ask?queryId=${queryId}`);
  expect(readPending(journalFile)).toBeNull();
});

it("rejects a quote above the caller cap before signing or submitting", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-mcp-test-"));
  dirs.push(dir);
  const journalFile = path.join(dir, "payment.json");
  const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": quote } }));
  await expect(payForResearch({ url: "https://example.test/api/agent/ask", body: { question: "question" },
    account, journalFile, maxAmountUsdc: 0.03, fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow(/exceeds/);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(readPending(journalFile)).toBeNull();
});

