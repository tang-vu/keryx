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

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function rpc() {
  vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body));
    expect(req.method).toBe("eth_chainId");
    return Response.json({ jsonrpc: "2.0", id: req.id, result: "0x4cef52" });
  });
}

it("retains a paid 500 receipt and blocks another debit until recovery", async () => {
  rpc();
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
    account, journalFile, expectedPayee: payee, expectedAmountMicros: "80000", maxAmountUsdc: 1, fetchImpl: fetchImpl as typeof fetch };
  await expect(payForResearch(input)).rejects.toThrow(/Payment settled; HTTP 500/);
  expect(readPending(journalFile)).toMatchObject({ status: "settled", amountUsdc: "0.08", settlementId: "circle-settlement" });
  expect(JSON.parse(Buffer.from(readPending(journalFile)!.paymentResponse!, "base64").toString("utf8"))).toMatchObject({ transaction: "circle-settlement" });
  const queryId = readPending(journalFile)!.queryId;
  await expect(payForResearch(input)).rejects.toThrow(/previous payment may have settled/i);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  const poll = vi.fn().mockResolvedValue(Response.json({ status: "completed", queryId, answer: "saved answer" }));
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
    account, journalFile, expectedPayee: payee, expectedAmountMicros: "80000", maxAmountUsdc: 0.03, fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow(/exceeds/);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(readPending(journalFile)).toBeNull();
});

it("retains original response-loss admission across a module restart and GET-only recovery", async () => {
  rpc(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-mcp-test-")); dirs.push(dir);
  const journalFile = path.join(dir, "payment.json"), fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": quote } }))
    .mockRejectedValueOnce(new Error("secret bearer URL marker"));
  const input = { url: "https://example.test/api/agent/ask", body: { question: "question", budget: 0.03 }, account,
    journalFile, expectedPayee: payee, expectedAmountMicros: "80000", maxAmountUsdc: 1, fetchImpl: fetchImpl as typeof fetch };
  await expect(payForResearch(input)).rejects.toThrow(/Payment outcome unknown/);
  const original = readPending(journalFile)!; vi.resetModules(); const reopened = await import("./local-payment.mts");
  await expect(reopened.payForResearch(input)).rejects.toThrow(/previous payment/); expect(fetchImpl).toHaveBeenCalledTimes(2);
  const poll = vi.fn().mockResolvedValue(Response.json({ queryId: original.queryId, status: "completed", answer: "original saved answer" }));
  await reopened.recoverResearch("https://example.test", journalFile, poll as typeof fetch);
  expect(poll).toHaveBeenCalledOnce(); expect(poll.mock.calls[0][1]).not.toHaveProperty("method", "POST");
  expect(readPending(journalFile)).toBeNull();
});

it("retains admission for wrong completed query identity", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-mcp-test-")); dirs.push(dir);
  const journalFile = path.join(dir, "payment.json");
  const original = { queryId: `a2a_${"a".repeat(64)}`, authorizationId: `0x${"a".repeat(64)}`, amountUsdc: "0.08", status: "unconfirmed" };
  fs.writeFileSync(journalFile, JSON.stringify(original));
  await expect(recoverResearch("https://example.test", journalFile, vi.fn().mockResolvedValue(Response.json({ status: "completed", queryId: `a2a_${"b".repeat(64)}` })) as typeof fetch)).rejects.toThrow(/identity mismatched/);
  expect(readPending(journalFile)).toEqual(original);
});

it("forwards observed overdue uncertainty while preserving the original journal through GET-only recovery", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-mcp-overdue-")); dirs.push(dir);
  const journalFile = path.join(dir, "payment.json"), original = { queryId: `a2a_${"a".repeat(64)}`,
    authorizationId: `0x${"a".repeat(64)}`, amountUsdc: "0.08", status: "unconfirmed" };
  fs.writeFileSync(journalFile, JSON.stringify(original));
  const data = { queryId: original.queryId, status: "processing", escalation: { state: "overdue", escalationNeeded: true,
    creatorPaymentState: "payment_boundary_crossed", evaluation: "on_observation", remedy: "none" } };
  const poll = vi.fn().mockResolvedValue(Response.json(data));
  expect((await recoverResearch("https://example.test", journalFile, poll as typeof fetch)).data).toEqual(data);
  expect(poll).toHaveBeenCalledOnce(); expect(poll.mock.calls[0][1]).not.toHaveProperty("method", "POST");
  expect(poll.mock.calls[0][0]).toBe(`https://example.test/api/agent/ask?queryId=${original.queryId}`);
  expect(readPending(journalFile)).toEqual(original);
});

it("delayed recovery cannot clear a replacement journal and held recovery never signs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-mcp-test-")); dirs.push(dir);
  const journalFile = path.join(dir, "payment.json");
  const original = { queryId: `a2a_${"a".repeat(64)}`, authorizationId: `0x${"a".repeat(64)}`, amountUsdc: "0.08", status: "unconfirmed" };
  fs.writeFileSync(journalFile, JSON.stringify(original));
  let release!: (response: Response) => void;
  const poll = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
  const recovering = recoverResearch("https://example.test", journalFile, poll as typeof fetch);
  await expect(payForResearch({ url: "https://example.test/api/agent/ask", body: {}, account, journalFile,
    expectedPayee: payee, expectedAmountMicros: "80000", maxAmountUsdc: 1 })).rejects.toThrow(/admission is held/);
  const replacement = { ...original, queryId: `a2a_${"b".repeat(64)}`, authorizationId: `0x${"b".repeat(64)}` };
  fs.writeFileSync(journalFile, JSON.stringify(replacement)); // Simulate an older writer outside the new lock contract.
  release(Response.json({ status: "completed", queryId: original.queryId })); await recovering;
  expect(readPending(journalFile)).toEqual(replacement);
  fs.mkdirSync(`${journalFile}.lock`);
  const held = await recoverResearch("https://example.test", journalFile,
    vi.fn().mockResolvedValue(Response.json({ status: "completed", queryId: replacement.queryId })) as typeof fetch);
  expect(held).toHaveProperty("instructions"); expect(readPending(journalFile)).toEqual(replacement);
});

it.each(["completed","review_required","observation-failed","wrong-original"])("queued paid original uses GET only through %s", async outcome=>{
  rpc();const dir=fs.mkdtempSync(path.join(os.tmpdir(),"keryx-mcp-queued-"));dirs.push(dir);
  const journalFile=path.join(dir,"payment.json");vi.useFakeTimers();
  const fetchImpl=vi.fn().mockResolvedValueOnce(new Response("{}",{status:402,headers:{"PAYMENT-REQUIRED":quote}}))
    .mockImplementationOnce(async()=>{
      const payment=readPending(journalFile)!;
      const receipt=Buffer.from(JSON.stringify({success:true,network:"eip155:5042002",payer:account.address,transaction:"circle-original"})).toString("base64");
      return Response.json({queryId:payment.queryId,status:"queued"},{status:202,headers:{"PAYMENT-RESPONSE":receipt}});
    }).mockImplementationOnce(async(_url,init)=>{
      expect(init).not.toHaveProperty("method","POST");expect(init.redirect).toBe("error");
      const payment=readPending(journalFile)!;
      if(outcome==="observation-failed")return Response.json({error:"unavailable"},{status:503});
      return Response.json({queryId:outcome==="wrong-original"?"substitution":payment.queryId,status:outcome==="review_required"?outcome:"completed",answer:"original"});
    });
  const attempt=payForResearch({url:"https://example.test/api/agent/ask",body:{question:"q",budget:0.03,responseMode:"async"},account,
    journalFile,expectedPayee:payee,expectedAmountMicros:"80000",maxAmountUsdc:1,waitForCompletionMs:6000,fetchImpl:fetchImpl as typeof fetch});
  const observed=attempt.then(value=>({value}),error=>({error}));
  await vi.advanceTimersByTimeAsync(2000);const result=await observed;
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  if(outcome==="completed"){expect(result).toHaveProperty("value");expect(readPending(journalFile)).toBeNull();}
  else{expect(result).toHaveProperty("error");expect(readPending(journalFile)?.settlementId).toBe("circle-original");}
});

