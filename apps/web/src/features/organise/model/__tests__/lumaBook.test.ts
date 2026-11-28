import { beforeEach, describe, expect, it } from "vitest";

import {
  addNames,
  markChecked,
  readChecked,
  readExport,
  readNames,
  readTicks,
  writeExport,
  writeTicks,
} from "../lumaBook";

const EV = "0x00000000000000000000000000000000000000Ee";
const ALICE = "0x00000000000000000000000000000000000000A1";
const DAVE = "0x00000000000000000000000000000000000000D4";
const GUEST = "0x00000000000000000000000000000000000000c3";

describe("lumaBook: data belongs to the organiser wallet that loaded it", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps names, exports and ticks per organiser wallet", () => {
    addNames(EV, ALICE, [{ wallet: GUEST, name: "Erin", email: "erin@example.com", luma: "pending" }]);
    writeExport(EV, ALICE, { name: "luma.csv", text: "x", at: 1 });
    writeTicks(EV, ALICE, [GUEST.toLowerCase()]);
    expect(readNames(EV, ALICE)[GUEST.toLowerCase()]?.name).toBe("Erin");
    // a new organiser of the same event on this device starts with nothing
    expect(readNames(EV, DAVE)).toEqual({});
    expect(readExport(EV, DAVE)).toBeNull();
    expect(readTicks(EV, DAVE)).toBeNull();
  });

  it("keeps the door checks per event, whoever the organiser is, so no guest is approved twice", () => {
    markChecked(EV, GUEST, 5);
    expect(readChecked(EV)[GUEST.toLowerCase()]).toBe(5);
  });

  it("moves data saved under the older per-event key to the organiser who reads it first", () => {
    window.localStorage.setItem(`kb:luma:ticks:${EV.toLowerCase()}`, JSON.stringify([GUEST.toLowerCase()]));
    expect(readTicks(EV, ALICE)).toEqual([GUEST.toLowerCase()]);
    expect(window.localStorage.getItem(`kb:luma:ticks:${EV.toLowerCase()}`)).toBeNull();
    expect(readTicks(EV, DAVE)).toBeNull();
  });
});
