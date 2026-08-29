import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0037_testnet_economics.sql"),
  "utf8",
);

describe("testnet economics migration", () => {
  it("adds only a nullable compact observer projection", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS economics_data jsonb");
    expect(migration).not.toMatch(/NOT NULL|DEFAULT/i);
    expect(migration).not.toMatch(/payment_events|UPDATE|INSERT|DELETE/i);
  });
});
