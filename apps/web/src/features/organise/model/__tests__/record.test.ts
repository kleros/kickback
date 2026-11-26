import { describe, expect, it } from "vitest";

import { foldRecord, recordCsv, type RecordLog } from "../record";

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
        log("AttendeeAdded", 9, { staker: A }),
        log("ChallengeResolved", 9, { staker: A, attended: true, ruling: 1n }),
        log("Paid", 9, { account: A, to: A, amount: 15n, eth: true }),
        log("PayoutsReleased", 9, { share: 15n }),
        log("Paid", 10, { account: A, to: A, amount: 15n, eth: true }),
        // Kleros refused to rule: what is left is split between C and the matcher
        log("ChallengeResolved", 11, { staker: C, attended: false, ruling: 0n }),
        log("HeldShareSplit", 11, { staker: C, each: 2n }),
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
      heldSplit: { each: 2n },
    });
    expect(c.payments.map((p) => p.kind)).toEqual(["challenge"]);
    const org = r.wallets.get(ORG.toLowerCase())!;
    expect(org.klerosFees).toMatchObject([{ staker: C, amount: 15n, caseId: 1001n }]);
    expect(org.payments.map((p) => p.kind)).toEqual(["challenge"]);
    expect(r.created?.block).toBe(1n);
  });

  it("tells an organiser's add from an unanswered challenge, and a refund from a payout", () => {
    const r = foldRecord(
      [
        log("Deposited", 1, { staker: A, amount: 10n }),
        log("Deposited", 2, { staker: B, amount: 10n }),
        log("Rejected", 3, { staker: B }),
        log("Paid", 3, { account: B, to: B, amount: 10n, eth: true }),
        log("Challenged", 4, { staker: A, deposit: 15n }),
        log("AttendeeAdded", 5, { staker: A }),
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

describe("recordCsv", () => {
  it("quotes cells that need it, keeps formulas inert and lists the event-wide steps last", () => {
    const csv = recordCsv(
      [{ name: "Ann, B", wallet: A, status: "Came", deposit: "0.01 ETH", paid: "0.02 ETH", paymentTxs: "t1 | t2" }],
      [{ label: "Payouts released", detail: "Each attendee's share: 0.02 ETH", tx: "t3" }],
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "Name,Wallet,Status,Deposit,Deposit transaction,Paid out,Payment transactions,Challenge fee paid,Challenge transaction,Answer,Answer transaction,Ruling,Settled transaction,Challenge money back,Challenge money transactions,Notes,Event transaction",
    );
    expect(lines[1]).toBe(`"Ann, B",${A},Came,0.01 ETH,,0.02 ETH,t1 | t2,,,,,,,,,,`);
    expect(lines[2]).toBe("Payouts released,,Each attendee's share: 0.02 ETH,,,,,,,,,,,,,,t3");
    expect(
      recordCsv([{ name: "=SUM(A1)" }], [])
        .split("\n")[1]
        ?.startsWith("'=SUM(A1)"),
    ).toBe(true);
  });
});
