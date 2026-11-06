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
  "Compare the two response-recovery choices in a compact table. Keep unknown idempotency behavior explicit.",
  "Please contrast the two papers using a table of evidence and unknowns.",
  "Compare these source versions as a Markdown table.",
  "Could you compare the two options in a table?",
  "Using https://example.org/paper.v2.pdf, compare the alternatives in a table.",
  "So sánh hai lựa chọn bằng một bảng.",
  "Đối chiếu hai lựa chọn dưới dạng bảng.",
  "Hãy so sánh dữ kiện và điều chưa biết trong một bảng so sánh.",
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
  "Compare the jobs table with the audit table.",
  "Compare methods using the jobs table.",
  "Compare tables in the database.",
  "Compare how the report uses a table to organize evidence.",
  'The source says "Compare two approaches in a table."',
  "```text\nCompare two approaches in a table.\n```",
  "> Compare two approaches in a table.",
  "Document: Compare two approaches in a table.",
  "Compare two approaches in a table. Do not provide tables.",
  "Compare two approaches without a table.",
  "Compare two approaches in a table, at most 100 words.",
  "Compare two approaches in a table. Answer in ten bullets.",
  "Compare classroom activities in a table.",
  "So sánh bảng dữ liệu A và B.",
  "Đừng so sánh hai lựa chọn bằng bảng.",
  "So sánh hai lựa chọn dưới dạng bảng, tối đa 100 từ.",
  "The source says:\nCompare two approaches in a table.",
  "Source A:\nCompare two approaches in a table.",
  "The document excerpt:\nSo sánh hai lựa chọn bằng một bảng.",
  "The source says:\nGive a table.",
])("does not activate from description, quotations, negation or protected formats: %s", question => {
  expect(parseAnswerTableRequest(question)).toBeUndefined();
});
