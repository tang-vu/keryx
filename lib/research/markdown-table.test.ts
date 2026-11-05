import { expect, it } from "vitest";
import { parseMarkdownTable } from "./markdown-table";
it("parses rectangular tables without splitting escaped or code pipes", () => {
  expect(parseMarkdownTable("| A | B |\n| :--- | ---: |\n| x\\|y | `a|b` |\n| a|\u200bb | c |"))
    .toEqual({ headers: ["A", "B"], rows: [["x|\u200by", "`a|b`"], ["a|\u200bb", "c"]] });
});
it.each(["| A | B |\n| -- | --- |\n| x | y |", "| A | B |\n| --- | --- |\n| x |", "| A | B |\n| --- | --- |\n| `x | y |",
  "|\u200b A | B |\n| --- | --- |\n| x | y |", "| A | B |\n| --- | --- |", "| A | |\n| --- | --- |\n| x | y |"])("leaves malformed/literal content visible: %s", text => {
  expect(parseMarkdownTable(text)).toBeUndefined();
});
