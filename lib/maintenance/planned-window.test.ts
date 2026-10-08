import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, symlinkSync, linkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { maintenanceStatus, MAX_WINDOW_MS, parsePlannedWindow, readWindowControl, WINDOW_FORMAT, type PlannedWindow } from "./planned-window";

export const fixtureWindow: PlannedWindow = { format: WINDOW_FORMAT, id: "synthetic-281", announcedAt: "2026-10-08T10:00:00.000Z",
  startsAt: "2026-10-08T10:05:00.000Z", endsAt: "2026-10-08T10:15:00.000Z", phase: "draining", message: "Synthetic non-production maintenance." };
describe("bounded maintenance control", () => {
  it("distinguishes upcoming, drain, active and exact expired window without reopening admission", () => {
    const state = (date: string, phase: PlannedWindow["phase"] = "draining") => maintenanceStatus({ kind: "valid", window: { ...fixtureWindow, phase } }, Date.parse(date));
    expect(state(fixtureWindow.announcedAt)).toMatchObject({ state: "upcoming", planned: true, admissionClosed: false });
    expect(state(fixtureWindow.startsAt)).toMatchObject({ state: "draining", admissionClosed: true });
    expect(state(fixtureWindow.startsAt, "active")).toMatchObject({ state: "active", admissionClosed: true });
    expect(state(fixtureWindow.endsAt)).toMatchObject({ state: "overrun", planned: false, admissionClosed: true });
    expect(state("2026-10-08T09:59:59.999Z")).toMatchObject({ state: "control-unavailable", admissionClosed: true });
    expect(maintenanceStatus({ kind: "absent" }, 0)).toMatchObject({ state: "normal", applicationStatus: "not-probed" });
    expect(maintenanceStatus({ kind: "unavailable" }, 0).admissionClosed).toBe(true);
  });
  it("refuses scope extensions, invalid time/clock, unbounded windows and unsafe messages", () => {
    for (const change of [{ phase: "normal" }, { extra: true }, { id: "../unsafe" }, { message: "x\n" }, { message: "x".repeat(301) },
      { startsAt: fixtureWindow.endsAt }, { announcedAt: fixtureWindow.startsAt }, { announcedAt: fixtureWindow.endsAt }, { endsAt: new Date(Date.parse(fixtureWindow.startsAt) + MAX_WINDOW_MS + 1).toISOString() },
      { endsAt: "2026-10-08" }]) expect(() => parsePlannedWindow({ ...fixtureWindow, ...change })).toThrow();
    expect(() => maintenanceStatus({ kind: "absent" }, NaN)).toThrow();
  });
});

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) {
  if (!resolve(directory).startsWith(join(resolve(tmpdir()), "keryx-maintenance-"))) throw Error("Unexpected fixture cleanup path");
  rmSync(directory, { recursive: true, force: true });
} });
it("never creates a missing control directory, and refuses unsupported native profiles", () => {
  expect(readWindowControl(join(tmpdir(), "absent-maintenance-directory-281"))).toEqual({ kind: "unavailable" });
  if (process.platform !== "linux") {
    const directory = mkdtempSync(join(tmpdir(), "keryx-maintenance-")); directories.push(directory);
    const control = join(directory, "control"); mkdirSync(control, { mode: 0o700 });
    writeFileSync(join(control, "window.json"), JSON.stringify(fixtureWindow), { mode: 0o600 });
    expect(readWindowControl(control)).toEqual({ kind: "unavailable" });
  }
});
it.runIf(process.platform === "linux")("reads a protected Linux marker without writes; malformed/aliased/unprotected controls refuse", () => {
  const directory = mkdtempSync(join(tmpdir(), "keryx-maintenance-")); directories.push(directory);
  const control = join(directory, "control"); mkdirSync(control, { mode: 0o700 });
  const file = join(control, "window.json");
  expect(readWindowControl(control)).toEqual({ kind: "absent" });
  writeFileSync(file, JSON.stringify(fixtureWindow), { mode: 0o600 }); const original = readFileSync(file);
  expect(readWindowControl(control)).toEqual({ kind: "valid", window: fixtureWindow }); expect(readFileSync(file)).toEqual(original);
  chmodSync(file, 0o644); expect(readWindowControl(control)).toEqual({ kind: "unavailable" }); chmodSync(file, 0o600);
  const alias = join(directory, "alias"); symlinkSync(control, alias); expect(readWindowControl(alias)).toEqual({ kind: "unavailable" });
  linkSync(file, join(directory, "hardlink")); expect(readWindowControl(control)).toEqual({ kind: "unavailable" });
  rmSync(join(directory, "hardlink")); writeFileSync(file, "{broken"); expect(readWindowControl(control)).toEqual({ kind: "unavailable" });
  const malformedUtf8 = Buffer.from(JSON.stringify(fixtureWindow));
  malformedUtf8[malformedUtf8.indexOf("Synthetic")] = 0xff;
  // JSON remains structurally valid if replacement decoding is used; native byte integrity must still refuse.
  expect(() => parsePlannedWindow(JSON.parse(malformedUtf8.toString("utf8")))).not.toThrow();
  writeFileSync(file, malformedUtf8); expect(readWindowControl(control)).toEqual({ kind: "unavailable" });
  rmSync(file); symlinkSync(join(directory, "missing-target"), file);
  expect(readWindowControl(control)).toEqual({ kind: "unavailable" });
});
