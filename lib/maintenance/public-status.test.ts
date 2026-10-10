import { describe, expect, it } from "vitest";
import { maintenanceStatus, parsePlannedWindow } from "./planned-window";
import { parsePublicMaintenanceStatus, parsePublicMaintenanceWindow, WINDOW_FORMAT, type PlannedWindow } from "./public-status";

const window: PlannedWindow = { format: WINDOW_FORMAT, id: "synthetic-status-281", announcedAt: "2026-10-11T10:00:00.000Z",
  startsAt: "2026-10-11T10:05:00.000Z", endsAt: "2026-10-11T10:15:00.000Z", phase: "active", message: "Synthetic <script>plain text</script>." };
const status = (checkedAt: string, phase: PlannedWindow["phase"] = "active") =>
  maintenanceStatus({ kind: "valid", window: { ...window, phase } }, Date.parse(checkedAt));

describe("closed public maintenance status", () => {
  it("accepts exact server snapshots for all states, without promoting unprobed health", () => {
    const values = [maintenanceStatus({ kind: "absent" }, 0), maintenanceStatus({ kind: "unavailable" }, 0),
      status("2026-10-11T09:59:59.999Z"), status(window.announcedAt), status(window.startsAt, "draining"),
      status(window.startsAt), status(window.endsAt)];
    expect(values.map(value => value.state)).toEqual(["normal", "control-unavailable", "control-unavailable", "upcoming", "draining", "active", "overrun"]);
    for (const value of values) {
      const parsed = parsePublicMaintenanceStatus(value);
      expect(parsed).toEqual(value); expect(parsed).not.toBe(value);
      expect(parsed?.applicationStatus).toBe("not-probed");
      if (value.window) expect(parsed?.window).not.toBe(value.window);
    }
    const source = status(window.startsAt), copied = parsePublicMaintenanceStatus(source)!;
    source.window!.message = "Changed caller state";
    expect(copied.window!.message).toBe(window.message);
  });
  it("refuses coercible enums, accessors, extra fields, invalid times and inconsistent server state", () => {
    const valid = status(window.startsAt);
    for (const patch of [{ state: ["active"] }, { state: { value: "active" } }, { planned: "true" }, { admissionClosed: false },
      { planned: false }, { window: null }, { state: "normal" }, { checkedAt: window.endsAt }, { checkedAt: "2026-10-11" },
      { applicationStatus: "healthy" }, { statusPath: "https://evil.invalid/maintenance/status" }, { invented: true }])
      expect(parsePublicMaintenanceStatus({ ...valid, ...patch })).toBeNull();
    for (const phase of [["active"], ["draining"], { value: "active" }, null, 1]) {
      const malformed = { ...window, phase };
      expect(parsePublicMaintenanceWindow(malformed)).toBeNull();
      expect(() => parsePlannedWindow(malformed)).toThrow("Invalid maintenance window");
      expect(parsePublicMaintenanceStatus({ ...valid, window: malformed })).toBeNull();
    }
    let reads = 0;
    expect(parsePublicMaintenanceStatus(Object.defineProperty({ ...valid }, "state", { enumerable: true,
      get() { reads++; return "active"; } }))).toBeNull();
    expect(reads).toBe(0);
    expect(parsePublicMaintenanceStatus({ ...valid, [Symbol("hidden")]: true })).toBeNull();
    expect(parsePublicMaintenanceStatus({ ...maintenanceStatus({ kind: "absent" }, 0), state: "upcoming", planned: true })).toBeNull();
  });
});
