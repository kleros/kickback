import { describe, expect, it } from "vitest";

import { projectedShare, unpaidLede } from "../payout";

const fmt = (u: bigint) => `${u} wei`;
const info = { phase: 1, depositAmount: 10n, stakerCount: 8, attendeeCount: 4, openCases: 1, payoutShare: 0n };

describe("projectedShare", () => {
  it("counts open cases and waiting challenges as the release does", () => {
    const challenges = [
      { wallet: "0xA", state: 1 },
      { wallet: "0xB", state: 2 },
      { wallet: "0xC", state: 3 },
    ];
    expect(projectedShare(info, challenges)).toMatchObject({ pool: 80n, shares: 6, share: 80n / 6n });
  });

  it("counts a ticked challenger once", () => {
    const r = projectedShare(info, [{ wallet: "0xA", state: 1 }], ["0xa"]);
    expect(r.shares).toBe(6);
  });

  it("uses the contract's share after the release", () => {
    expect(projectedShare({ ...info, phase: 2, payoutShare: 7n }, []).share).toBe(7n);
  });
});

describe("unpaidLede", () => {
  it("says the rest of a partly paid share, not the full share", () => {
    const text = unpaidLede(
      [
        { owed: 2n, partlyPaid: true },
        { owed: 16n, partlyPaid: false },
      ],
      5,
      16n,
      fmt,
    );
    expect(text).toContain("2 of 5 attendees still have money to claim");
    expect(text).toContain("1 is owed the rest of their share (2 wei, after");
    expect(text).toContain("1 is owed the full 16 wei");
    expect(text).not.toContain("not been paid yet");
  });

  it("collapses equal amounts", () => {
    const text = unpaidLede(
      [
        { owed: 2n, partlyPaid: true },
        { owed: 2n, partlyPaid: true },
      ],
      2,
      16n,
      fmt,
    );
    expect(text).toContain("Each is owed 2 wei");
  });

  it("keeps the plain wording when nobody is partly paid", () => {
    expect(unpaidLede([{ owed: 16n, partlyPaid: false }], 4, 16n, fmt)).toMatch(
      /^1 of 4 attendees has not been paid yet/,
    );
    expect(unpaidLede([], 4, 16n, fmt)).toBe("Each attendee's share is 16 wei. Every attendee has been paid.");
    expect(unpaidLede([], 4, 16n, fmt, 1)).toContain("one could not be delivered");
  });
});
