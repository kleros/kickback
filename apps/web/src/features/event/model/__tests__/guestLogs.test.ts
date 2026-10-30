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
  const result = foldGuestLogs(
    [
      deposited,
      { eventName: "Refunded", args: { to: wallet, amount: 5n }, blockNumber: 20n, transactionHash: payout },
      { eventName: "Payout", args: { to: wallet, amount: 15n }, blockNumber: 30n, transactionHash: payout },
      { eventName: "Refunded", args: { to: other, amount: 99n }, blockNumber: 40n, transactionHash: payout },
    ],
    10n,
  ).get(wallet.toLowerCase());
  expect(result).toMatchObject({ returned: { amount: 5n, block: 20n }, payoutTx: payout });
});

it("does not label a subsequent deposit as the earlier returned payment", () => {
  expect(
    foldGuestLogs(
      [
        deposited,
        { eventName: "Refunded", args: { to: wallet, amount: 5n }, blockNumber: 20n, transactionHash: payout },
        { ...deposited, blockNumber: 30n },
      ],
      10n,
    ).get(wallet.toLowerCase())?.returned,
  ).toBeUndefined();
});

it("uses the replacement payment rather than the refunded short payment", () => {
  const result = foldGuestLogs(
    [
      deposited,
      { eventName: "Refunded", args: { to: wallet, amount: 5n }, blockNumber: 20n, transactionHash: payout },
      { ...deposited, args: { from: wallet, amount: 10n }, blockNumber: 30n, transactionHash: payout },
      { eventName: "StakerRegistered", args: { staker: wallet }, blockNumber: 31n, transactionHash: payout },
    ],
    10n,
  ).get(wallet.toLowerCase());
  expect(result).toMatchObject({ deposited: 10n, txHash: payout, block: 30n });
});

it("keeps the latest valid pre-registration receipt through surplus returns and later payments", () => {
  const latest: Hash = `0x${"cd".repeat(32)}`;
  const result = foldGuestLogs(
    [
      { ...deposited, args: { from: wallet, amount: 10n } },
      { ...deposited, args: { from: wallet, amount: 15n }, blockNumber: 11n, transactionHash: latest },
      { eventName: "StakerRegistered", args: { staker: wallet }, blockNumber: 12n, transactionHash: payout },
      { eventName: "Refunded", args: { to: wallet, amount: 5n }, blockNumber: 13n, transactionHash: payout },
      { ...deposited, args: { from: wallet, amount: 10n }, blockNumber: 14n, transactionHash: payout },
    ],
    10n,
  ).get(wallet.toLowerCase());
  expect(result).toMatchObject({ deposited: 30n, txHash: latest, block: 11n });
});

it("clears fully returned receipts and does not combine separate short payments into one", () => {
  const refunded = {
    eventName: "Refunded",
    args: { to: wallet, amount: 5n },
    blockNumber: 20n,
    transactionHash: payout,
  };
  expect(foldGuestLogs([deposited, refunded], 5n).get(wallet.toLowerCase())).toMatchObject({
    deposited: 0n,
    returned: { amount: 5n },
  });
  expect(foldGuestLogs([deposited, refunded], 5n).get(wallet.toLowerCase())?.txHash).toBeUndefined();
  const shorts = foldGuestLogs([deposited, { ...deposited, transactionHash: payout, blockNumber: 11n }], 10n);
  expect(shorts.get(wallet.toLowerCase())?.txHash).toBeUndefined();
});

it("groups deposits in one transaction and replaces a rejected stake after a new payment", () => {
  const latest: Hash = `0x${"cd".repeat(32)}`;
  const result = foldGuestLogs(
    [
      deposited,
      { ...deposited, logIndex: 1 },
      { eventName: "StakerRegistered", args: { staker: wallet }, blockNumber: 11n, transactionHash: payout },
      { eventName: "Rejected", args: { wallet, refunded: 10n }, blockNumber: 12n, transactionHash: payout },
      { ...deposited, args: { from: wallet, amount: 10n }, blockNumber: 13n, transactionHash: latest },
      { eventName: "StakerRegistered", args: { staker: wallet }, blockNumber: 14n, transactionHash: payout },
    ],
    10n,
  ).get(wallet.toLowerCase());
  expect(result).toMatchObject({ deposited: 10n, txHash: latest, block: 13n });
  expect(result?.refundedBlock).toBeUndefined();
});
