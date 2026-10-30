import { kickbackAbi } from "@kickback/contracts";
import { decodeFunctionData, getAbiItem, getAddress, type Address, type Hash } from "viem";

import { MOCK_ACCOUNTS } from "@/lib/web3/mock-account";

import { expect, test } from "../fixtures";
import type { HardhatClient } from "../fixtures/hardhat";
import { deployOrganiserEvent, deposit, guestAccounts, register } from "../utils/organiser";

let snapshot: Hash;
test.beforeEach(async ({ hardhat }) => {
  snapshot = await hardhat.snapshot();
});
test.afterEach(async ({ hardhat }) => {
  await hardhat.revert({ id: snapshot });
});

async function listed(hardhat: HardhatClient, rejectPayment = false) {
  const event = await deployOrganiserEvent("Money states", 600);
  const guests = await guestAccounts(3);
  for (const guest of guests) await deposit(event.address, guest);
  await register(event.address, guests);
  await hardhat.setNextBlockTimestamp({ timestamp: BigInt(event.eventStart) });
  await hardhat.mine({ blocks: 1 });
  await hardhat.waitForTransactionReceipt({
    hash: await hardhat.writeContract({
      account: MOCK_ACCOUNTS.alice,
      address: event.address,
      abi: kickbackAbi,
      functionName: "postAttendance",
      args: [guests.slice(0, 2), 15000000000000000n],
    }),
  });
  if (rejectPayment) await hardhat.setCode({ address: guests[0]!, bytecode: "0x60006000fd" });
  const end = await hardhat.readContract({ address: event.address, abi: kickbackAbi, functionName: "challengeEndsAt" });
  await hardhat.setNextBlockTimestamp({ timestamp: end + 1n });
  await hardhat.mine({ blocks: 1 });
  await hardhat.waitForTransactionReceipt({
    hash: await hardhat.writeContract({
      account: MOCK_ACCOUNTS.alice,
      address: event.address,
      abi: kickbackAbi,
      functionName: "releasePayouts",
    }),
  });
  if (rejectPayment) await hardhat.setCode({ address: guests[0]!, bytecode: "0x" });
  return { ...event, guests };
}

async function assertWalletCall(hardhat: HardhatClient, contract: Address, wallet: Address, name: string) {
  const logs = await hardhat.getLogs({
    address: contract,
    fromBlock: 0n,
    events: [
      getAbiItem({ abi: kickbackAbi, name: "Claimed" }),
      getAbiItem({ abi: kickbackAbi, name: "EmergencyWithdrawn" }),
    ],
  });
  const matched = logs.filter((log) => log.eventName === (name === "claim" ? "Claimed" : "EmergencyWithdrawn"));
  const transaction = await hardhat.getTransaction({ hash: matched.at(-1)!.transactionHash! });
  expect(transaction?.from.toLowerCase()).toBe(wallet.toLowerCase());
  expect(decodeFunctionData({ abi: kickbackAbi, data: transaction!.input })).toEqual({
    functionName: name,
    args: [getAddress(wallet)],
  });
}

test("emergency withdraw after the deadline returns the full deposit to the connected wallet", async ({
  page,
  wallet,
  hardhat,
}) => {
  const event = await deployOrganiserEvent("No list", 600);
  const [guest] = await guestAccounts(1);
  await deposit(event.address, guest!);
  await register(event.address, [guest!]);
  const deadline = await hardhat.readContract({
    address: event.address,
    abi: kickbackAbi,
    functionName: "claimDeadline",
  });
  await hardhat.setNextBlockTimestamp({ timestamp: deadline + 1n });
  await hardhat.mine({ blocks: 1 });
  await page.goto(`/event/${event.address}?from=${event.deployBlock}`);
  await wallet.connect(guest!);
  const ticket = page.getByTestId("ticket");
  await expect(ticket).toHaveAttribute("data-state", "withdraw");
  await expect(ticket).toContainText("Your deposit returns in full.");
  await ticket.getByRole("button", { name: "Withdraw my deposit" }).click();
  await expect(ticket).toHaveAttribute("data-state", "withdrawn");
  await assertWalletCall(hardhat, event.address, guest!, "emergencyWithdraw");
  expect(await hardhat.getBalance({ address: event.address })).toBe(0n);
});

test("at the deadline a deposited guest has no enabled Deposit control anywhere on the page", async ({
  page,
  wallet,
  hardhat,
}) => {
  const event = await deployOrganiserEvent("Closed deposits", 600);
  const [guest] = await guestAccounts(1);
  await deposit(event.address, guest!);
  const deadline = await hardhat.readContract({
    address: event.address,
    abi: kickbackAbi,
    functionName: "claimDeadline",
  });
  await hardhat.setNextBlockTimestamp({ timestamp: deadline });
  await hardhat.mine({ blocks: 1 });
  await page.goto(`/event/${event.address}?from=${event.deployBlock}`);
  await wallet.connect(guest!);
  await expect(page.getByTestId("ticket")).toHaveAttribute("data-state", "already");
  await expect(page.getByRole("button", { name: /^Deposit(?:\s|$)/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Deposit(?:\s|$)/ })).toHaveCount(0);
});

test("claim when owed sends claim(wallet) and clears the amount owed", async ({ page, wallet, hardhat }) => {
  const event = await listed(hardhat, true);
  const guest = event.guests[0]!;
  await page.goto(`/event/${event.address}?from=${event.deployBlock}`);
  await wallet.connect(guest);
  const ticket = page.getByTestId("ticket");
  await expect(ticket).toHaveAttribute("data-state", "claim");
  await expect(ticket).toContainText("0.015 ETH ready to claim.");
  await ticket.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(ticket).toHaveAttribute("data-state", "paid-out");
  await assertWalletCall(hardhat, event.address, guest, "claim");
  expect(
    await hardhat.readContract({ address: event.address, abi: kickbackAbi, functionName: "owed", args: [guest] }),
  ).toBe(0n);
});

test("release replaces receipts with paid-out and not-on-list ticket states", async ({ page, wallet, hardhat }) => {
  const event = await listed(hardhat);
  await page.goto(`/event/${event.address}?from=${event.deployBlock}`);
  await wallet.connect(event.guests[0]!);
  const ticket = page.getByTestId("ticket");
  await expect(ticket).toHaveAttribute("data-state", "paid-out");
  await expect(ticket).toContainText("Paid out 0.015 ETH");
  await expect(page.getByRole("button", { name: /^Deposit(?:\s|$)/ })).toHaveCount(0);
  await wallet.connect(event.guests[2]!);
  await expect(ticket).toHaveAttribute("data-state", "not-attended");
  await expect(ticket).toContainText("Not on the attendance list");
  await expect(ticket).toContainText("Contesting opens in a later release.");
});

test("a short payer can be returned from the guests row and sees the dated return on their ticket", async ({
  page,
  wallet,
  hardhat,
}) => {
  const event = await deployOrganiserEvent("Short payer", 600);
  const [guest] = await guestAccounts(1);
  await hardhat.waitForTransactionReceipt({
    hash: await hardhat.sendTransaction({ account: guest!, to: event.address, value: 5000000000000000n }),
  });
  await page.goto(`/organise/${event.address}/guests?from=${event.deployBlock}`);
  await wallet.connect("alice");
  const returnLink = page.getByRole("link", { name: "Return 0.005 ETH" });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const link = (await returnLink.boundingBox())!;
    const row = (await page.getByTestId("guest-row").first().boundingBox())!;
    expect(link.x + link.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
    expect(link.height).toBeLessThan(28);
  }
  await returnLink.click();
  const dialog = page.getByRole("dialog", { name: "Return stray ETH" });
  await expect(dialog.getByLabel("To wallet")).toHaveValue(new RegExp(`^${guest!}$`, "i"));
  await expect(dialog.getByLabel("Amount, ETH")).toHaveValue("0.005");
  expect(await hardhat.getBalance({ address: event.address })).toBe(5000000000000000n);
  await dialog.getByRole("button", { name: "Return", exact: true }).click();
  await expect(page.getByTestId("done")).toHaveText("Returned.");
  const returns = await hardhat.getLogs({
    address: event.address,
    fromBlock: BigInt(event.deployBlock),
    event: getAbiItem({ abi: kickbackAbi, name: "Refunded" }),
  });
  const returnedAt = Number((await hardhat.getBlock({ blockNumber: returns.at(-1)!.blockNumber! })).timestamp);
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    returnedAt * 1000,
  );
  await page.goto(`/event/${event.address}?from=${event.deployBlock}`);
  await wallet.connect(guest!);
  await expect(page.getByTestId("ticket")).toHaveAttribute("data-state", "returned");
  await expect(page.getByTestId("ticket-status")).toHaveText(`0.005 ETH returned on ${date}`);
});
