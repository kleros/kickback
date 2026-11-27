import { describe, expect, it } from "vitest";

import { NEXT_STEP, phaseLabel, phaseOf } from "../phase";

const ev = {
  phase: 0,
  eventStart: 100,
  eventEnd: 200,
  claimDeadline: 1000,
  challengeEndsAt: 0,
  attendeeCount: 0,
  stakerCount: 2,
  capacity: 0,
};

describe("phaseOf", () => {
  it("an ended event with deposits asks for attendance", () => {
    expect(phaseOf(ev, 300)).toBe("Attendance due");
    expect(phaseOf({ ...ev, attendeeCount: 1 }, 300)).toBe("List not closed");
  });

  it("an ended event with no deposits has nothing due", () => {
    const empty = { ...ev, stakerCount: 0 };
    expect(phaseOf(empty, 150)).toBe("Live now");
    expect(phaseOf(empty, 300)).toBe("Ended");
    expect(phaseLabel("Ended", empty)).toBe("Ended · no deposits");
    expect(NEXT_STEP.Ended.done).toBe(true);
    expect(NEXT_STEP.Ended.tab).toBeNull();
    // after the deadline a refund lowers stakerCount too: it stays the missed deadline
    expect(phaseOf(empty, 2000)).toBe("Past the deadline");
  });
});
