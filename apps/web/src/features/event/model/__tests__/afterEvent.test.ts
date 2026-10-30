import { parseEther } from "viem";
import { expect, it } from "vitest";

import { depositState, depositsOpen } from "../depositState";
import { FIXTURE, galleryInput } from "../fixtures";

const base = () => ({
  ...galleryInput("already"),
  claimDeadline: 2000,
  chainNow: 2001,
  guest: { status: 1, owed: 0n, attended: false, payoutShare: parseEther("0.015") },
});

it("offers full emergency withdrawal only strictly after the deadline for an Open staker", () => {
  const input = base();
  expect(depositState(input)).toMatchObject({ key: "withdraw", action: "withdraw", button: "Withdraw my deposit" });
  expect(
    depositState(input)
      .lines.map((l) => l.text)
      .join(" "),
  ).toMatch(/list never came.*deposit returns in full/i);
  for (const change of [{ chainNow: 2000 }, { phase: 1 }, { guest: { ...input.guest, status: 0 } }])
    expect(depositState({ ...input, ...change }).action).not.toBe("withdraw");
});

it("owed takes precedence over receipts, refunds and finalized states", () => {
  const input = base();
  expect(depositState({ ...input, phase: 2, guest: { ...input.guest, owed: parseEther("0.005") } })).toMatchObject({
    key: "claim",
    action: "claim",
    button: "Claim",
    amount: "0.005",
  });
});

it("shows payout share and its log transaction instead of a stale successful deposit", () => {
  const input = base();
  expect(
    depositState({
      ...input,
      phase: 2,
      guest: { ...input.guest, status: 2, attended: true },
      send: { account: FIXTURE.wallet, status: "success", hash: FIXTURE.tx },
      history: { ...input.history!, payoutTx: FIXTURE.tx },
    }),
  ).toMatchObject({
    key: "paid-out",
    label: "Paid out",
    amount: "0.015",
    action: "none",
    lines: [
      { text: "Paid out 0.015 ETH" },
      { text: "", link: { label: "Payout transaction", href: `https://etherscan.io/tx/${FIXTURE.tx}` } },
    ],
  });
});

it("shows the no-show state only for a finalized non-attending staker", () => {
  expect(depositState({ ...base(), phase: 2 })).toMatchObject({
    key: "not-attended",
    label: "Not on the attendance list",
    lines: [{ text: "Contesting opens in a later release." }],
  });
});

it("shows the actual Refunded amount and date for a short payer", () => {
  expect(
    depositState({
      ...base(),
      guest: undefined,
      history: { deposited: parseEther("0.005"), returned: { amount: parseEther("0.005"), at: 2000 } },
      dayText: () => "30 Oct",
    }),
  ).toMatchObject({ key: "returned", amount: "0.005", lines: [{ text: "0.005 ETH returned on 30 Oct" }] });
});

it("closes every deposit entry point independently of the receipt state", () => {
  const input = galleryInput("already");
  expect(depositsOpen(input.phase, input.eventStart, input.eventStart - 1)).toBe(true);
  expect(depositsOpen(input.phase, input.eventStart, input.eventStart)).toBe(false);
  expect(depositsOpen(1, input.eventStart, input.eventStart - 1)).toBe(false);
  expect(depositsOpen(0, input.eventStart, undefined)).toBe(false);
});

it("requires switching networks before either money action", () => {
  const input = base();
  expect(depositState({ ...input, wallet: { ...input.wallet, chainId: 42161 } }).action).toBe("switch");
  expect(
    depositState({
      ...input,
      wallet: { ...input.wallet, chainId: 42161, needsChain: true },
      guest: { ...input.guest, owed: 1n },
    }).action,
  ).toBe("add-chain");
});

it("keeps money transactions busy and does not mistake their receipts for deposits", () => {
  const input = base();
  expect(
    depositState({ ...input, moneySend: { account: input.wallet.address, action: "withdraw", status: "pending" } }),
  ).toMatchObject({ action: "none", disabled: true });
  expect(depositState({ ...input, guest: { ...input.guest, status: 2 } }).key).toBe("withdrawn");
  expect(depositState({ ...input, busy: true }).disabled).toBe(true);
  expect(depositState({ ...input, sent: { outcome: "pending", data: "0x1234", hash: FIXTURE.tx, at: 0 } }).action).toBe(
    "none",
  );
});

it("does not show money or returned states for a disconnected wallet", () => {
  const input = base();
  expect(depositState({ ...input, wallet: { ...input.wallet, status: "disconnected" }, phase: 2 }).key).toBe("closed");
});
