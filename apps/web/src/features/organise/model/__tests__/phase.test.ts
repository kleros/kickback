import { describe, expect, it } from "vitest";

import { casesLine, NEXT_STEP, payoutsReadyStep, phaseLabel, phaseOf } from "../phase";

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
    // unless nobody held a deposit at the end: then nothing was due, and it stays "Ended"
    expect(phaseOf(empty, 2000, 0, false)).toBe("Ended");
    expect(phaseOf(empty, 2000, 0, true)).toBe("Past the deadline");
    expect(phaseOf(empty, 2000, 0, undefined)).toBe("Past the deadline");
  });
});

describe("payoutsReadyStep", () => {
  const fmt = (u: bigint) => `${u} wei`;
  it("mentions the no-shows' share only when there are no-shows", () => {
    const none = payoutsReadyStep({ openCases: 0, readyToSettle: 0, share: 10n, deposit: 10n, fmt });
    expect(none.title).toBe("Release payouts");
    expect(none.detail).toBe(
      "The challenge window is over. Release payouts on the Payout tab: every attendee gets their 10 wei deposit back.",
    );
    expect(none.detail).not.toContain("no-shows");
    const some = payoutsReadyStep({ openCases: 0, readyToSettle: 0, share: 15n, deposit: 10n, fmt });
    expect(some.detail).toContain(
      "each attendee gets 15 wei, their deposit back plus a share of the no-shows' deposits.",
    );
  });

  it("asks to settle ruled cases before the release, and says a share is held for the rest", () => {
    const two = payoutsReadyStep({ openCases: 3, readyToSettle: 2, share: 10n, deposit: 10n, fmt });
    expect(two.title).toBe("Settle the rulings, then release payouts");
    expect(two.detail).toBe(
      "2 Kleros rulings are ready to settle on the Payout tab. Settle them first so their results count in the split, then release payouts. 1 case is still with Kleros: a share will be held for it until the jurors rule.",
    );
    const one = payoutsReadyStep({ openCases: 1, readyToSettle: 1, share: 10n, deposit: 10n, fmt });
    expect(one.title).toBe("Settle the ruling, then release payouts");
    expect(one.detail).toContain("Settle it first so its result counts in the split");
    const deciding = payoutsReadyStep({ openCases: 2, readyToSettle: 0, share: 10n, deposit: 10n, fmt });
    expect(deciding.title).toBe("Release payouts");
    expect(deciding.detail).toContain(
      "2 cases are still with Kleros: a share will be held for each until the jurors rule.",
    );
  });
});

describe("casesLine", () => {
  it("counts ruled cases and cases still with the jurors", () => {
    expect(casesLine(1, 1)).toBe("The Kleros case has been ruled and is ready to settle on the Payout tab.");
    expect(casesLine(3, 3)).toBe("All 3 Kleros cases have been ruled and are ready to settle on the Payout tab.");
    expect(casesLine(2, 1)).toBe(
      "1 ruling is ready to settle on the Payout tab; 1 case is still waiting for the jurors.",
    );
    expect(casesLine(5, 2)).toBe(
      "2 rulings are ready to settle on the Payout tab; 3 cases are still waiting for the jurors.",
    );
  });
});
