import { type Address } from "viem";
import { describe, expect, it } from "vitest";

import { eventStatus, listedEvents } from "../listing";

const A = "0x00000000000000000000000000000000000000aA" as Address;
const B = "0x00000000000000000000000000000000000000bB" as Address;
const C = "0x00000000000000000000000000000000000000cC" as Address;

describe("listedEvents", () => {
  it("keeps the factory's order without repeats", () => {
    const rows = listedEvents([
      { contract: A, fromBlock: 100 },
      { contract: C, fromBlock: 9 },
      { contract: A.toLowerCase() as Address, fromBlock: 100 },
      { contract: B, fromBlock: 5 },
    ]);
    expect(rows).toEqual([
      { contract: A, from: 100 },
      { contract: C, from: 9 },
      { contract: B, from: 5 },
    ]);
  });

  it("leaves `from` unset for a featured event read from block 0", () => {
    expect(listedEvents([{ contract: A, fromBlock: 0 }])).toEqual([{ contract: A, from: undefined }]);
  });

  it("keeps at most `limit` rows", () => {
    expect(
      listedEvents(
        [A, C, B].map((contract) => ({ contract })),
        2,
      ).map((row) => row.contract),
    ).toEqual([A, C]);
  });

  it("is empty with nothing to list", () => {
    expect(listedEvents([])).toEqual([]);
  });
});

describe("eventStatus", () => {
  const start = 1_000;
  const deadline = 2_000;
  it.each([
    [0, 999, "booking"],
    [0, 1_000, "started"],
    [0, 2_000, "overdue"],
    [1, 500, "listed"],
    [2, 500, "paid"],
    [3, 500, "cancelled"],
  ] as const)("phase %i at %i is %s", (phase, now, status) => {
    expect(eventStatus(phase, start, deadline, now)).toBe(status);
  });
});
