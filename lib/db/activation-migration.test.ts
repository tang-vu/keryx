import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0035_activation_funnel.sql"),
  "utf8",
);

describe("activation funnel migration", () => {
  it("stores only day, allowlisted event, and aggregate count", () => {
    expect(migration).toContain("day date not null");
    expect(migration).toContain("event text not null check");
    expect(migration).toContain("count bigint not null");
    for (const forbidden of ["wallet", "actor", "ip_address", "cookie", "user_agent", "question", "source_id", "payment_id"]) {
      expect(migration.match(new RegExp(`\\b${forbidden}\\s+(text|inet|uuid|jsonb)`, "i"))).toBeNull();
    }
  });

  it("keeps writes service-role-only and increments atomically", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.activation_events from anon, authenticated");
    expect(migration).toContain("on conflict (day, event) do update");
    expect(migration).toContain("grant execute on function public.increment_activation_event");
  });
});
