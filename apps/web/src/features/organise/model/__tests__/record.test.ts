import { describe, expect, it } from "vitest";

import { foldRecord, heldSplitCount, recordCsv, type RecordLog } from "../record";

const A = "0x00000000000000000000000000000000000000aA" as const;
const B = "0x00000000000000000000000000000000000000bB" as const;
const log = (eventName: string, n: number, args: RecordLog["args"] = {}): RecordLog => ({
  eventName,
  args,
  transactionHash: `0x${n.toString(16).padStart(64, "0")}`,
  blockNumber: BigInt(n),
});

describe("foldRecord", () => {
  it("keeps every deposit, refund, payout and event-wide step with its transaction", () => {
    const r = foldRecord([
      log("Deposited", 1, { staker: A, amount: 10n }),
      log("Deposited", 2, { staker: B, amount: 10n }),
      log("Rejected", 3, { staker: B }),
      log("Paid", 3, { account: B, to: B, amount: 10n, eth: true }),
      log("ListClosed", 4),
      log("PayoutsReleased", 5, { share: 10n }),
      log("Paid", 6, { account: A, to: A, amount: 10n, eth: true }),
      { ...log("Paid", 7, { account: A }), blockNumber: null },
    ]);
    expect(r.wallets.get(A.toLowerCase())?.deposit?.block).toBe(1n);
    expect(r.wallets.get(A.toLowerCase())?.payments.map((p) => p.block)).toEqual([6n]);
    expect(r.wallets.get(B.toLowerCase())?.rejected?.block).toBe(3n);
    expect(r.wallets.get(B.toLowerCase())?.payments).toHaveLength(1);
    expect(r.wallets.get(B.toLowerCase())?.payments[0]?.kind).toBe("refund");
    expect(r.wallets.get(A.toLowerCase())?.payments[0]?.kind).toBe("payout");
    expect(r.listClosed?.block).toBe(4n);
    expect(r.released).toMatchObject({ block: 5n, share: 10n });
  });
});

describe("foldRecord: what each payment was for", () => {
  const C = "0x00000000000000000000000000000000000000cC" as const;
  const ORG = "0x00000000000000000000000000000000000000dD" as const;

  it("labels challenge money apart from the payout, and records each challenge step", () => {
    const r = foldRecord(
      [
        log("EventCreated", 1),
        log("Deposited", 2, { staker: A, amount: 10n }),
        log("Deposited", 3, { staker: B, amount: 10n }),
        log("Deposited", 4, { staker: C, amount: 10n }),
        log("ListClosed", 5),
        // A challenges and sends 1 wei too much: the change is challenge money
        log("Challenged", 6, { staker: A, deposit: 15n }),
        log("Paid", 6, { account: A, to: A, amount: 1n, eth: true }),
        log("Challenged", 7, { staker: C, deposit: 15n }),
        // the organiser sends C's challenge to Kleros
        log("ChallengeMatched", 8, { staker: C, matcher: ORG, arbitratorDisputeID: 1001n }),
        // A is not answered: the release accepts the challenge and returns the fee
        log("AttendeeAdded", 9, { attendee: A }),
        log("ChallengeResolved", 9, { staker: A, attended: true, ruling: 1n }),
        log("Paid", 9, { account: A, to: A, amount: 15n, eth: true }),
        log("PayoutsReleased", 9, { share: 15n }),
        log("Paid", 10, { account: A, to: A, amount: 15n, eth: true }),
        // Kleros refused to rule: what is left is split between C and the matcher
        log("ChallengeResolved", 11, { staker: C, attended: false, ruling: 0n }),
        log("HeldShareSplit", 11, { staker: C, each: 2n, attendees: 1n, openCases: 0n }),
        log("Paid", 11, { account: C, to: C, amount: 7n, eth: true }),
        log("Paid", 11, { account: ORG, to: ORG, amount: 8n, eth: true }),
      ],
      new Map([
        [`0x${(9).toString(16).padStart(64, "0")}`, { from: B, fn: "releasePayouts" }],
        [`0x${(10).toString(16).padStart(64, "0")}`, { from: A, fn: "withdraw" }],
      ]),
    );
    const a = r.wallets.get(A.toLowerCase())!;
    expect(a.payments.map((p) => p.kind)).toEqual(["challenge", "challenge", "payout"]);
    expect(a.payments[2]?.via).toBe("claimed");
    expect(a.challenge).toMatchObject({ fee: 15n, answer: { kind: "unanswered" } });
    const c = r.wallets.get(C.toLowerCase())!;
    expect(c.challenge).toMatchObject({
      answer: { kind: "kleros", matcher: ORG, caseId: 1001n },
      resolved: { ruling: 0, attended: false },
      heldSplit: { each: 2n, attendees: 1n, openCases: 0n },
    });
    expect(c.payments.map((p) => p.kind)).toEqual(["challenge"]);
    const org = r.wallets.get(ORG.toLowerCase())!;
    expect(org.klerosFees).toMatchObject([{ staker: C, amount: 15n, caseId: 1001n }]);
    expect(org.payments.map((p) => p.kind)).toEqual(["challenge"]);
    expect(r.created?.block).toBe(1n);
    // a guest released: the record names the wallet
    expect(r.released).toMatchObject({ share: 15n, by: B });
  });

  it("tells an organiser's add from an unanswered challenge, and a refund from a payout", () => {
    const r = foldRecord(
      [
        log("Deposited", 1, { staker: A, amount: 10n }),
        log("Deposited", 2, { staker: B, amount: 10n }),
        log("Rejected", 3, { staker: B }),
        log("Paid", 3, { account: B, to: B, amount: 10n, eth: true }),
        log("Challenged", 4, { staker: A, deposit: 15n }),
        log("AttendeeAdded", 5, { attendee: A }),
        log("ChallengeResolved", 5, { staker: A, attended: true, ruling: 1n }),
        log("Paid", 5, { account: A, to: A, amount: 15n, eth: true }),
      ],
      new Map([[`0x${(5).toString(16).padStart(64, "0")}`, { from: B, fn: "addAttendees" }]]),
    );
    expect(r.wallets.get(B.toLowerCase())?.payments[0]?.kind).toBe("refund");
    expect(r.wallets.get(A.toLowerCase())?.challenge?.answer?.kind).toBe("added");
  });

  it("counts challenge ETH a wallet refused, and paid out later with its share, as challenge money", () => {
    const r = foldRecord([
      log("Deposited", 1, { staker: A, amount: 10n }),
      log("Challenged", 2, { staker: A, deposit: 15n }),
      log("ChallengeResolved", 3, { staker: A, attended: true, ruling: 1n }),
      log("PaymentFailed", 3, { account: A, amount: 15n, eth: true }),
      log("PayoutsReleased", 4, { share: 10n }),
      // distribute: the share first, then the owed ETH
      log("Paid", 5, { account: A, to: A, amount: 10n, eth: true }),
      log("Paid", 5, { account: A, to: A, amount: 15n, eth: true }),
    ]);
    const a = r.wallets.get(A.toLowerCase())!;
    expect(a.failed).toMatchObject([{ amount: 15n, kind: "challenge" }]);
    expect(a.payments.map((p) => [p.kind, p.amount])).toEqual([
      ["payout", 10n],
      ["challenge", 15n],
    ]);
  });
});

describe("foldRecord: who was put on the list, and how", () => {
  const C = "0x00000000000000000000000000000000000000cC" as const;
  const D = "0x00000000000000000000000000000000000000dD" as const;
  it("records a save, the close and an add after closing, apart from a challenge's answer", () => {
    const r = foldRecord([
      log("Deposited", 1, { staker: A, amount: 10n }),
      log("Deposited", 2, { staker: B, amount: 10n }),
      log("Deposited", 3, { staker: C, amount: 10n }),
      log("Deposited", 4, { staker: D, amount: 10n }),
      // Save 1 for now
      log("AttendeeAdded", 5, { attendee: A }),
      // Confirm and close
      log("AttendeeAdded", 6, { attendee: B }),
      log("ListClosed", 6),
      // D challenges; one addAttendees adds C (no challenge) and answers D
      log("Challenged", 7, { staker: D, deposit: 15n }),
      log("AttendeeAdded", 8, { attendee: C }),
      log("AttendeeAdded", 8, { attendee: D }),
      log("ChallengeResolved", 8, { staker: D, attended: true, ruling: 1n }),
    ]);
    expect(r.wallets.get(A.toLowerCase())?.added?.how).toBe("saved");
    expect(r.wallets.get(B.toLowerCase())?.added?.how).toBe("closed");
    expect(r.wallets.get(C.toLowerCase())?.added?.how).toBe("late");
    expect(r.wallets.get(D.toLowerCase())?.added?.how).toBe("challenge");
    expect(r.attendanceTxs.map((a) => [a.how, a.block, a.wallets])).toEqual([
      ["saved", 5n, [A]],
      ["closed", 6n, [B]],
      ["late", 8n, [C]],
    ]);
  });
});

describe("recordCsv", () => {
  it("quotes cells that need it, keeps formulas inert and lists the event-wide steps last", () => {
    const csv = recordCsv(
      [{ name: "Ann, B", wallet: A, status: "Came", deposit: "0.01 ETH", paid: "0.02 ETH", paymentTxs: "t1 | t2" }],
      [{ label: "Payouts released", detail: "Each attendee's share: 0.02 ETH", tx: "t3" }],
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "Name,Wallet,Status,Deposit,Deposit transaction,Put on the list transaction,Refunded,Paid out,Payment transactions,Challenge fee paid,Challenge transaction,Answer,Answer transaction,Ruling,Settled transaction,Kleros fee paid,Sent to Kleros transactions,Challenge money back,Challenge money transactions,Notes,Event transaction",
    );
    expect(lines[1]).toBe(`"Ann, B",${A},Came,0.01 ETH,,,,0.02 ETH,t1 | t2,,,,,,,,,,,,`);
    expect(lines[2]).toBe("Payouts released,,Each attendee's share: 0.02 ETH,,,,,,,,,,,,,,,,,,t3");
    // a wallet that sent a case to Kleros: its fee and transaction under their own headers, not the challenge's
    const matcher = recordCsv([{ wallet: B, klerosFee: "0.03 ETH", klerosTxs: "t4" }], [])
      .trim()
      .split("\n")[1]!
      .split(",");
    const at = (h: string) => lines[0]!.split(",").indexOf(h);
    expect(matcher[at("Challenge transaction")]).toBe("");
    expect(matcher[at("Challenge fee paid")]).toBe("");
    expect(matcher[at("Sent to Kleros transactions")]).toBe("t4");
    expect(matcher[at("Kleros fee paid")]).toBe("0.03 ETH");
    expect(
      recordCsv([{ name: "=SUM(A1)" }], [])
        .split("\n")[1]
        ?.startsWith("'=SUM(A1)"),
    ).toBe(true);
  });
});

describe("foldRecord: handovers to another organiser", () => {
  const ALICE = "0x00000000000000000000000000000000000000a1" as const;
  const DAVE = "0x00000000000000000000000000000000000000d4" as const;
  const ZERO = "0x0000000000000000000000000000000000000000" as const;

  it("records each handover and credits every step to the organiser at that time", () => {
    const handover = log("OwnershipTransferred", 6, { previousOwner: ALICE, newOwner: DAVE });
    const r = foldRecord(
      [
        log("OwnershipTransferred", 1, { previousOwner: ZERO, newOwner: ALICE }),
        log("EventCreated", 1),
        log("Deposited", 2, { staker: A, amount: 10n }),
        log("Deposited", 3, { staker: B, amount: 10n }),
        log("AttendeeAdded", 4, { attendee: A }),
        log("ListClosed", 4),
        log("Paid", 5, { account: B, to: B, amount: 1n, eth: true }),
        handover,
        // released in the same block as the handover, after it: Dave is the organiser by then
        { ...log("PayoutsReleased", 6, { share: 20n }), transactionHash: `0x${"e".repeat(64)}` },
      ],
      new Map([[`0x${"e".repeat(64)}`, { from: DAVE, fn: "releasePayouts" }]]),
    );
    expect(r.firstOrganiser).toBe(ALICE);
    expect(r.handovers).toEqual([{ tx: handover.transactionHash, block: 6n, from: ALICE, to: DAVE }]);
    expect(r.listClosed?.by).toBe(ALICE);
    expect(r.attendanceTxs[0]?.by).toBe(ALICE);
    expect(r.wallets.get(B.toLowerCase())?.payments[0]?.organiserThen).toBe(ALICE);
    expect(r.released).toMatchObject({ by: DAVE, organiserThen: DAVE });
  });

  it("credits a release in the handover's block but before its log to the earlier organiser", () => {
    const r = foldRecord([
      log("OwnershipTransferred", 1, { previousOwner: ZERO, newOwner: ALICE }),
      { ...log("PayoutsReleased", 6, { share: 20n }), transactionHash: `0x${"f".repeat(64)}` },
      log("OwnershipTransferred", 6, { previousOwner: ALICE, newOwner: DAVE }),
    ]);
    expect(r.released?.organiserThen).toBe(ALICE);
    expect(r.handovers).toHaveLength(1);
  });

  it("counts held shares that were split, leaving out a split of nothing", () => {
    const r = foldRecord([
      log("Challenged", 2, { staker: A, deposit: 1n }),
      log("Challenged", 3, { staker: B, deposit: 1n }),
      log("HeldShareSplit", 8, { staker: A, each: 5n, attendees: 2n, openCases: 0n }),
      log("HeldShareSplit", 9, { staker: B, each: 0n, attendees: 2n, openCases: 0n }),
    ]);
    expect(heldSplitCount(r)).toBe(1);
    expect(heldSplitCount(undefined)).toBeUndefined();
  });
});
