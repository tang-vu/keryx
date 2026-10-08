import { expect, it } from "vitest";
import { cslIssued } from "./reference-export-core";

it.each([
  ["2024", [[2024]]], ["2024-02", [[2024, 2]]], ["2024-02-29", [[2024, 2, 29]]],
  ["2023-02-29", undefined], ["2024-04-31", undefined], ["2024-00", undefined],
  ["2024-13", undefined], ["2024-1", undefined], ["2024-02-00", undefined],
  ["2024-02-29T00:00:00Z", undefined], ["unknown", undefined], [undefined, undefined],
] as const)("retains only recorded calendar precision for %s", (value, expected) => {
  expect(cslIssued(value)).toEqual(expected ? { "date-parts": expected } : undefined);
});
