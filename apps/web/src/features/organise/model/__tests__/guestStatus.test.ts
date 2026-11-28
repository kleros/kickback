import { describe, expect, it } from "vitest";

import type { GuestRow } from "../../operations/read";
import { guestStatus } from "../guestStatus";

const W = "0x00000000000000000000000000000000000000aA" as const;
const challenge = (over: Partial<NonNullable<GuestRow["challenge"]>>): NonNullable<GuestRow["challenge"]> => ({
  state: 2,
  matchEndsAt: 0,
  matcher: W,
  organiser: W,
  deposit: 0n,
  arbitratorDisputeID: 0n,
  localDisputeID: 0n,
  arbitrationPaid: 0n,
  ...over,
});

describe("guestStatus", () => {
  it("tells a ruled Kleros case that is not settled yet from one still with the jurors", () => {
    const row = (c: NonNullable<GuestRow["challenge"]>): GuestRow => ({
      wallet: W,
      status: 1,
      attended: false,
      challenge: c,
    });
    expect(guestStatus(row(challenge({ isRuled: true, ruling: 2 })), 1, false).text).toBe(
      "Kleros ruled they did not come · not settled yet",
    );
    expect(guestStatus(row(challenge({ isRuled: true, ruling: 1 })), 1, false).text).toBe(
      "Kleros ruled they came · not settled yet",
    );
    expect(guestStatus(row(challenge({ isRuled: false })), 1, false).text).toBe("With Kleros");
    // a ruling the contract does not know cannot be settled
    expect(guestStatus(row(challenge({ isRuled: true, ruling: 3 })), 1, false).text).toBe("With Kleros");
  });

  it("says 'paid so far' while a Kleros case still holds a share", () => {
    const row: GuestRow = { wallet: W, status: 1, attended: true };
    expect(guestStatus(row, 2, false, { sharePaid: 10n, payoutShare: 10n, openCases: 1 }).text).toBe(
      "Came · paid so far",
    );
    expect(guestStatus(row, 2, false, { sharePaid: 10n, payoutShare: 10n, openCases: 0 }).text).toBe("Came · paid");
  });
});
