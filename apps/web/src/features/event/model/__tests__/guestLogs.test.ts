import type { Address, Hash } from "viem";
import { expect, it } from "vitest";

import { FIXTURE } from "../fixtures";
import { foldGuestLogs } from "../guestLogs";

const wallet = FIXTURE.wallet;
const other: Address = "0x1111111111111111111111111111111111111111";
const payout: Hash = `0x${"ab".repeat(32)}`;
const deposited = {
  eventName: "Deposited",
  args: { from: wallet, amount: 5n },
  blockNumber: 10n,
  transactionHash: FIXTURE.tx,
};

it("tracks Refunded amount and block and Payout transaction by recipient", () => {
  const result = foldGuestLogs([
    deposited,
    { eventName: "Refunded", args: { to: wallet, amount: 5n }, blockNumber: 20n, transactionHash: payout },
    { eventName: "Payout", args: { to: wallet, amount: 15n }, blockNumber: 30n, transactionHash: payout },
    { eventName: "Refunded", args: { to: other, amount: 99n }, blockNumber: 40n, transactionHash: payout },
  ]).get(wallet.toLowerCase());
  expect(result).toMatchObject({ returned: { amount: 5n, block: 20n }, payoutTx: payout });
});

it("does not label a subsequent deposit as the earlier returned payment", () => {
  expect(
    foldGuestLogs([
      deposited,
      { eventName: "Refunded", args: { to: wallet, amount: 5n }, blockNumber: 20n, transactionHash: payout },
      { ...deposited, blockNumber: 30n },
    ]).get(wallet.toLowerCase())?.returned,
  ).toBeUndefined();
});
