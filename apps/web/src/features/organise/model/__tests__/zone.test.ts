import { describe, expect, it } from "vitest";

import { zonedUnix } from "../zone";

describe("zonedUnix", () => {
  it("reads the wall time in the event's zone, not the browser's", () => {
    expect(zonedUnix("2026-11-24T18:00", "UTC")).toBe(Date.UTC(2026, 10, 24, 18) / 1000);
    expect(zonedUnix("2026-11-24T18:00", "Asia/Kolkata")).toBe(Date.UTC(2026, 10, 24, 12, 30) / 1000);
    expect(zonedUnix("2026-07-10T18:00", "Europe/Paris")).toBe(Date.UTC(2026, 6, 10, 16) / 1000);
    expect(zonedUnix("2026-11-24T18:00", "America/New_York")).toBe(Date.UTC(2026, 10, 24, 23) / 1000);
  });
  it("rejects a malformed value", () => expect(zonedUnix("tomorrow", "UTC")).toBeNaN());
});
