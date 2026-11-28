import { describe, expect, it, vi } from "vitest";

import type { WalletRecord } from "../../model/record";

vi.mock("../../hooks/useOrganiserEvent", () => ({ useOrganiserEvent: () => ({}) }));

const { recordFileName, txLinks } = await import("../GuestsView");

const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

describe("txLinks", () => {
  it("lists a guest's transactions in the order they happened", () => {
    const rec = {
      deposit: { tx: tx(1), block: 1n, amount: 1n },
      added: { tx: tx(2), block: 5n, how: "closed" },
      payments: [{ tx: tx(3), block: 9n, amount: 1n, to: "0x0", eth: true, kind: "payout" }],
      klerosFees: [],
      failed: [],
    } as unknown as WalletRecord;
    expect(txLinks(rec).map((l) => l.label)).toEqual(["Deposit", "Listed", "Payout"]);
  });

  it("puts challenge money paid back at the release before a payout sent later", () => {
    const rec = {
      deposit: { tx: tx(1), block: 1n, amount: 1n },
      challenge: { tx: tx(2), block: 6n, fee: 1n, answer: { kind: "unanswered", tx: tx(4), block: 8n } },
      payments: [
        { tx: tx(5), block: 12n, amount: 1n, to: "0x0", eth: true, kind: "payout" },
        { tx: tx(4), block: 8n, amount: 1n, to: "0x0", eth: true, kind: "challenge" },
      ],
      klerosFees: [],
      failed: [],
    } as unknown as WalletRecord;
    expect(txLinks(rec).map((l) => l.label)).toEqual([
      "Deposit",
      "Challenge",
      "Accepted (no answer in time)",
      "Challenge money back",
      "Payout",
    ]);
  });
});

describe("recordFileName", () => {
  it("keeps the event name readable in any script", () => {
    expect(recordFileName("R5S2 Récord Night")).toBe("R5S2-Récord-Night-record.csv");
    expect(recordFileName("東京ナイト")).toBe("東京ナイト-record.csv");
    expect(recordFileName("ไนท์ปาร์ตี้")).toBe("ไนท์ปาร์ตี้-record.csv");
    expect(recordFileName("!!! Party")).toBe("Party-record.csv");
    expect(recordFileName("!!!")).toBe("event-record.csv");
  });
});
