import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchMirrorDns, mirrorDnsAnswers, prepareBrowserDns } from "./ci-browser-dns.mjs";
const host = "archive.ubuntu.com";
const response = () => ({ Status: 0, TC: false, CD: false, Question: [{ name: host + ".", type: 1 }],
  Answer: [{ name: host + ".", type: 1, TTL: 60, data: "185.125.190.81" }] });
function fixture() {
  let hosts = "127.0.0.1 localhost\n", writes = 0, requests = 0;
  const io = { platform: "linux", arch: "x64", env: { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "Linux" },
    read: path => path === "/etc/hosts" ? hosts : 'ID=ubuntu\nVERSION_ID="24.04"\n',
    stat: () => ({ isFile: () => true, isSymbolicLink: () => false, size: hosts.length }),
    lookup: h => hosts.includes(`\t${h} #`), request: async () => { requests++; return ["185.125.190.81"]; },
    append: text => { writes++; hosts += text; } };
  return { io, counts: () => ({ writes, requests }), hosts: () => hosts };
}
test("refuses local/self-hosted/unknown OS before external requests or writes", async () => {
  for (const invalid of [{ platform: "win32" }, { arch: "arm64" }, { env: {} }, { read: () => "ID=debian\nVERSION_ID=12\n" },
    { read: () => 'ID=debian\nID=ubuntu\nVERSION_ID="24.04"\n' }]) {
    const f = fixture(); await assert.rejects(prepareBrowserDns({ ...f.io, ...invalid })); assert.deepEqual(f.counts(), { writes: 0, requests: 0 });
  }
});
test("healthy native resolution needs no DNS provider or hosts write", async () => {
  const f = fixture(); await prepareBrowserDns({ ...f.io, lookup: () => true }); assert.deepEqual(f.counts(), { writes: 0, requests: 0 });
});
test("recovers only fixed public mirror names, reads back and remains idempotent", async () => {
  const f = fixture(); assert.equal((await prepareBrowserDns(f.io)).recoveredAddresses, 3);
  assert.deepEqual(f.counts(), { writes: 1, requests: 3 }); await prepareBrowserDns(f.io); assert.deepEqual(f.counts(), { writes: 1, requests: 3 });
  assert(f.hosts().startsWith("127.0.0.1 localhost\n"));
});
test("malformed, unbound, private and non-IPv4 answers refuse", () => {
  assert.deepEqual(mirrorDnsAnswers(host, response()), ["185.125.190.81"]);
  for (const mutate of [b => b.Status = 2, b => b.TC = true, b => b.CD = true,
    b => b.Question[0].name = "foreign.test", b => b.Answer[0].name = "foreign.test", b => b.Answer[0].TTL = 0,
    ...["127.0.0.1", "10.1.1.1", "169.254.169.254", "192.0.2.1", "224.0.0.1", "::1", "185.125.190.81\nforeign"].map(ip => b => b.Answer[0].data = ip)]) {
    const b = response(); mutate(b); assert.throws(() => mirrorDnsAnswers(host, b));
  }
  assert.throws(() => mirrorDnsAnswers("foreign.test", response()));
});
test("accepts bound CNAME chains and refuses unrelated addresses", () => {
  const b = response(); b.Answer[0].name = "mirror.canonical.com.";
  b.Answer.push({ name: host + ".", type: 5, data: "mirror.canonical.com.", TTL: 60 });
  assert.deepEqual(mirrorDnsAnswers(host, b), ["185.125.190.81"]);
});
test("HTTPS DNS request is fixed, bounded, credential-free and rejects redirects/oversized wire", async () => {
  const data = response();
  await fetchMirrorDns(host, async (url, options) => {
    assert.equal(url.origin, "https://dns.google"); assert.equal(url.searchParams.get("name"), host);
    assert.equal(url.searchParams.get("cd"), "0"); assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit"); assert(options.signal instanceof AbortSignal);
    return Response.json(data);
  });
  await assert.rejects(fetchMirrorDns(host, async () => new Response("x".repeat(32769))));
  await assert.rejects(fetchMirrorDns("foreign.test", async () => { throw new Error("must not request"); }));
});
test("invalid provider data, append/readback failure and stale custom mappings stop", async () => {
  for (const extra of [{ request: async () => ["127.0.0.1"] }, { append: () => {} },
    { read: path => path === "/etc/hosts" ? "185.125.190.81 archive.ubuntu.com\n" : 'ID=ubuntu\nVERSION_ID="24.04"\n' }]) {
    const f = fixture(); await assert.rejects(prepareBrowserDns({ ...f.io, ...extra }));
  }
});
