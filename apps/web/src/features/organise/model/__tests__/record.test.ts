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
    expect(r.listClosed?.block).toBe(4n);
    expect(r.released).toMatchObject({ block: 5n, share: 10n });
  });
});

describe("recordCsv", () => {
  it("quotes cells that need it and lists the event-wide steps last", () => {
    const csv = recordCsv(
      [{ name: "Ann, B", wallet: A, status: "Came", deposit: "0.01 ETH", paid: "0.02 ETH", paymentTxs: ["t1", "t2"] }],
      [{ label: "Payouts released", tx: "t3" }],
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Name,Wallet,Status,Deposit,Deposit transaction,Paid out,Payment transactions");
    expect(lines[1]).toBe(`"Ann, B",${A},Came,0.01 ETH,,0.02 ETH,t1 t2`);
    expect(lines[2]).toBe("Payouts released,,,,,,t3");
  });
});
