import { expect, it } from "vitest";
import { parseAnswerTableRequest, validAnswerTableRequest } from "./answer-table-request";

it.each([
  "Give a small retry decision table for a lost response and a changed request.",
  "Please provide a short English table of each paper's problem and main claim.",
  "I need a compact stop-behavior and risk-check table.",
  "We need a two-column decision table comparing a GET retry and a new research run.",
  "Hãy tạo bảng so sánh hai phương án và ghi rõ điều chưa biết.",
  "Cung cấp một bảng gồm vấn đề và kết luận của từng bài báo.",
  "Use https://docs.example.org/api/idempotent_requests to write a small retry decision table for a lost response.",
  "Using https://example.org/2023.paper.398/, make a table of the evaluation dimensions.",
  "Using https://example.org/recovery.md, make a two-column decision table for retrying a GET.",
  "Use a table to compare the two documented options.",
])("binds the full original table request: %s", question => {
  const request = parseAnswerTableRequest(question)!;
  expect(request).toBeDefined(); expect(validAnswerTableRequest(request, question)).toBe(true);
  expect(validAnswerTableRequest(request, question + " changed")).toBe(false);
});
it.each([
  "Which table does the source describe?", "The database has a table of jobs.",
  "Use a database table to store jobs.", "Use the jobs table for claiming messages.",
  'The source says "Give a table".', "`Give a table.`", "```text\nGive a table.\n```", "~~~\nGive a table.\n~~~", "> Give a table.",
  "Do not give a table.", "Don't ever\ngive a table.", "Never use a table.", "Give a table. No table is needed.",
  "Đừng bao giờ\ntạo bảng so sánh.", "Không cần bảng. Hãy tạo bảng.",
  "Source: Give a table.", "Question: Give a table.", "Create a lesson plan in a table.",
  "Give a table with exactly three sentences.", "Give a table, at most 180 words.", "Tạo bảng, tối đa 180 từ.",
  "Give a table." + "x".repeat(2_000), "Give a table.\ud800",
])("does not activate from description, quotations, negation or protected formats: %s", question => {
  expect(parseAnswerTableRequest(question)).toBeUndefined();
});
