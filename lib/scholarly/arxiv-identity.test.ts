import { expect, it } from "vitest";
import { arxivDocumentId, questionArxivIds, targetArxivIds } from "./arxiv-identity";
import { arxivSearch } from "./arxiv";

it("recognizes bounded explicit HTML intent and legacy versioned identity", () => {
  expect(questionArxivIds("Compare https://arxiv.org/html/2606.02668v1 with https://arxiv.org/html/2607.13716v1#S1 and arXiv:2501.12345v2")).toEqual(["2606.02668v1", "2607.13716v1"]);
  expect(questionArxivIds("Read arXiv:hep-th/9901001v2.")).toEqual(["hep-th/9901001v2"]);
});

it("parses an observed URL independently of free-text question intent", () => {
  expect(arxivDocumentId("https://ARXIV.ORG:443/html/2606.02668v1?download=true#S1")).toBe("2606.02668v1");
  for (const value of ["see https://arxiv.org/abs/2606.02668v1", " https://arxiv.org/abs/2606.02668v1", "https://arxiv.org\\@evil.example/abs/2606.02668v1", "https://arxiv.org/html/2606.02668v1\n", "https://arxiv.org/search?query=arxiv:2606.02668v1"]) expect(arxivDocumentId(value)).toBeUndefined();
});

it("retains an exact mixed-case legacy provider result and its observed spelling", async () => {
  const id = "math.GT/0307245v1";
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/${id}</id><title>Internal identity fixture</title></entry></feed>`;
  const requested: string[] = [];
  const records = await arxivSearch(`Read arXiv:${id}`, undefined, async url => { requested.push(url); return atom; });
  expect(records).toHaveLength(1);
  expect(records[0].arxivId).toBe(id);
  expect(new URL(requested[0]).searchParams.get("id_list")).toBe(id);
  expect(new URL(records[0].recordUrl).searchParams.get("id_list")).toBe(id);
  expect(await arxivSearch("Read arXiv:math.GT/0307245v2", undefined, async () => atom)).toEqual([]);
  expect(await arxivSearch("Read arXiv:math.gt/0307245v1", undefined, async () => atom)).toHaveLength(1);
});

it("checks every bare target identity while discovery remains capped at two", () => {
  const ids = ["2606.02668v1", "hep-th/9901001v2", "math.GT/0307245v1"];
  expect(targetArxivIds(`Compare ${ids.join(", ")}.`)).toEqual(ids);
  expect(questionArxivIds(ids.map(id => `arXiv:${id}`).join(", "))).toEqual(ids.slice(0, 2));
  expect(questionArxivIds(ids.join(", "))).toEqual([]);
  expect(targetArxivIds("hep-th/9901001v0 math.GT/0307245v1.other 2606.02668v1evil")).toEqual([]);
});

it("recognizes every explicit discovery form in ledger targets, including unspaced prefixes", () => {
  for (const id of ["2606.02668v1", "hep-th/9901001v2", "math.GT/0307245v1"]) {
    for (const reference of [`arXiv${id}`, `arXiv:${id}`, `arXiv ${id}`, `https://arxiv.org/html/${id}`, `https://arxiv.org/abs/${id}`, `https://arxiv.org/pdf/${id}.pdf`]) {
      expect(questionArxivIds(reference)).toEqual([id]);
      expect(targetArxivIds(reference)).toEqual([id]);
      expect(targetArxivIds(`Methods in ${reference}`)).toEqual([id]);
    }
  }
});
