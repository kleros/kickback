import { parseEther } from "viem";
import { describe, expect, it } from "vitest";

import { shareExample } from "../share";
import { dayText, deadlineText, eventDateText, sameClock, visitorText } from "../when";

const IST = { offset: 330, zone: "IST" };
// Wed 4 Nov 2026, 18:00 IST
const START = Date.UTC(2026, 10, 4, 12, 30) / 1000;

describe("shareExample", () => {
  it("splits one in five no-shows over the registered guests, as previewShare rounds", () => {
    const ex = shareExample(parseEther("0.01"), 10);
    expect(ex).toMatchObject({ deposits: 10, attend: 8, noShows: 2, real: true });
    expect(ex.back).toBe(parseEther("0.0125"));
    expect(ex.bonus).toBe(parseEther("0.0025"));
    expect(ex.pool).toBe(parseEther("0.02"));
  });

  it("rounds down like the contract", () => {
    const ex = shareExample(parseEther("0.01"), 7);
    expect(ex.attend).toBe(6);
    expect(ex.back).toBe((parseEther("0.01") * 7n) / 6n);
  });

  it("uses the contract's figure when given", () => {
    expect(shareExample(parseEther("0.01"), 10, 123n).back).toBe(123n);
  });

  it("falls back to ten deposits under two registered", () => {
    expect(shareExample(parseEther("0.01"), 0)).toMatchObject({ deposits: 10, attend: 8, real: false });
  });

  it("uses the posted list once there is one, and never divides by zero", () => {
    expect(shareExample(parseEther("0.01"), 4, undefined, 2)).toMatchObject({
      deposits: 4,
      attend: 2,
      noShows: 2,
      basis: "list",
    });
    expect(shareExample(parseEther("0.01"), 4, 1n, 3).basis).toBe("paid");
    expect(shareExample(parseEther("0.01"), 4, undefined, 0).basis).toBe("estimate");
  });
});

describe("dates on the event's clock", () => {
  it("prints the start in the event's zone", () => {
    expect(eventDateText(START, IST)).toBe("Wed 4 Nov 2026, 18:00 IST");
    expect(deadlineText(START, IST, undefined, START)).toBe("Wed 4 Nov, 18:00 IST");
    expect(dayText(START, IST)).toBe("4 Nov");
  });

  it("prints the visitor's own time and knows when it is the same clock", () => {
    expect(visitorText(START, "UTC")).toBe("Wed 4 Nov, 12:30");
    expect(sameClock(START, IST, "UTC")).toBe(false);
    expect(sameClock(START, IST, "Asia/Kolkata")).toBe(true);
  });

  it("falls back to the visitor's zone without an event clock", () => {
    expect(eventDateText(START, null, "UTC")).toMatch(/^Wed 4 Nov 2026, 12:30 (UTC|GMT)$/);
  });

  it("keeps the year on a deadline in another year", () => {
    expect(deadlineText(START, IST, undefined, START - 366 * 86_400)).toBe("Wed 4 Nov 2026, 18:00 IST");
  });

  it("says a time cannot be shown instead of crashing", () => {
    for (const bad of [1e15, Number.NaN])
      for (const text of [eventDateText(bad, IST), dayText(bad, null), visitorText(bad, "UTC")])
        expect(text).toBe("Date not available");
    expect(sameClock(1e15, IST, "UTC")).toBe(true);
  });
});
