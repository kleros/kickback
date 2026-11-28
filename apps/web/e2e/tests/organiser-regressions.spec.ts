import { presenceEventAbi } from "@kickback/contracts";
import type { Page } from "@playwright/test";
import { parseEther, type Address } from "viem";

import { MOCK_ACCOUNTS } from "@/lib/web3/mock-account";

import { expect, test, type HardhatClient, type WalletFixture } from "../fixtures";

const BOB = MOCK_ACCOUNTS.bob;
const DAVE: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

const iso = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 16);
const minute = (t: number) => Math.ceil(t / 60) * 60;

async function createEvent(page: Page, wallet: WalletFixture, name: string, start: number, end: number) {
  await page.goto("/organise/new");
  await wallet.connect("alice");
  await page.getByLabel("Event name").fill(name);
  await page.getByLabel("Luma event page").fill("https://luma.com/r5fix");
  await page.getByRole("textbox", { name: /^Starts/ }).fill(iso(start));
  await page.getByRole("textbox", { name: /^Ends/ }).fill(iso(end));
  await page.getByRole("button", { name: "Create the event" }).click();
  await page.waitForURL(/\/organise\/0x[0-9a-fA-F]{40}$/, { timeout: 90_000 });
  return page.url().split("/").pop() as Address;
}

async function deposit(hardhat: HardhatClient, from: Address, event: Address) {
  const hash = await hardhat.writeContract({
    address: event,
    abi: presenceEventAbi,
    functionName: "deposit",
    account: from,
    chain: hardhat.chain,
    value: parseEther("0.01"),
  });
  await hardhat.waitForTransactionReceipt({ hash });
}

test("the create page renders the same on the server and in a browser on another day", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // a browser clock days away from the server's: the default dates are set only after mount
  await page.clock.install({ time: new Date(Date.now() + 4 * 86_400_000) });
  await page.goto("/organise/new");
  await expect(page.getByRole("textbox", { name: /^Starts/ })).not.toHaveValue("");
  expect(errors.filter((m) => /hydrat|did not match/i.test(m))).toEqual([]);
});

test("a turn-away still confirming is shown and locked after a reload", async ({ page, wallet, time, hardhat }) => {
  test.setTimeout(240_000);
  await time.install();
  const now = await time.getHardhatTime();
  const ev = await createEvent(page, wallet, "R5 Reload Pending", minute(now + 7200), minute(now + 10800));
  await deposit(hardhat, BOB, ev);
  await deposit(hardhat, DAVE, ev);
  await page.goto(`/organise/${ev}/guests`);
  await wallet.connect("alice");
  await expect(page.getByTestId("guest-row")).toHaveCount(2, { timeout: 30_000 });
  await page.getByLabel(`Turn away ${DAVE}`).check();
  await page.getByRole("button", { name: /^Turn away 1 guest/ }).click();
  await hardhat.setAutomine(false);
  try {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Turn away/ })
      .click();
    await expect(page.getByTestId("pending")).toHaveText("Turning away 1 guest… Waiting for confirmation.");
    await expect(page.locator(`[data-wallet="${DAVE.toLowerCase()}"]`)).toContainText("Turning away");
    await page.reload();
    await wallet.connect("alice");
    await expect(page.getByTestId("earlier-pending")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel(`Turn away ${BOB}`)).toBeDisabled();
  } finally {
    await hardhat.mine({ blocks: 1 });
    await hardhat.setAutomine(true);
  }
  await expect(page.getByTestId("earlier-pending")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(`[data-wallet="${DAVE.toLowerCase()}"]`)).toContainText("Turned away", {
    timeout: 20_000,
  });
});

test("attendance refuses a file that is not a check-in list, and keeps hand ticks", async ({
  page,
  wallet,
  time,
  hardhat,
}) => {
  test.setTimeout(240_000);
  await time.install();
  const now = await time.getHardhatTime();
  const ev = await createEvent(page, wallet, "R5 Hand Ticks", minute(now + 3600), minute(now + 7200));
  await deposit(hardhat, BOB, ev);
  await deposit(hardhat, DAVE, ev);
  await time.setTime(minute(now + 7200) + 120);
  await page.goto(`/organise/${ev}/attendance`);
  await wallet.connect("alice");
  await expect(page.getByTestId("attendance-row")).toHaveCount(2, { timeout: 30_000 });
  await page.getByTestId("checkin-csv").setInputFiles({
    name: "empty.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(""),
  });
  await expect(page.getByTestId("error")).toContainText("This file has no guest rows.");
  await page.getByTestId("checkin-csv").setInputFiles({
    name: "names.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,email\nBob,bob@example.com\n"),
  });
  await expect(page.getByTestId("error")).toContainText("This file has no guest wallets");
  await expect(page.getByTestId("checkin-loaded")).toHaveCount(0);
  // a tick by hand, with no file loaded, survives a tab change
  await page.getByLabel(`${DAVE} came`).check();
  await expect(page.getByTestId("attendance-row").filter({ hasText: "not saved yet" })).toHaveCount(1);
  await page.getByRole("link", { name: "Guests", exact: true }).click();
  await expect(page.getByTestId("guests")).toBeVisible();
  await page.getByRole("link", { name: "Attendance", exact: true }).click();
  await expect(page.getByLabel(`${DAVE} came`)).toBeChecked();
  await expect(page.getByLabel(`${BOB} came`)).not.toBeChecked();
});

test("a handover gives the new organiser a clean start and is in the record", async ({
  page,
  wallet,
  time,
  hardhat,
}) => {
  test.setTimeout(300_000);
  const ALICE = MOCK_ACCOUNTS.alice;
  const CAROL: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const call = async (from: Address, event: Address, functionName: "transferOwnership" | "acceptOwnership") => {
    const hash = await hardhat.writeContract({
      address: event,
      abi: presenceEventAbi,
      functionName,
      args: functionName === "transferOwnership" ? [DAVE] : [],
      account: from,
      chain: hardhat.chain,
    } as never);
    await hardhat.waitForTransactionReceipt({ hash });
  };
  await time.install();
  const now = await time.getHardhatTime();
  const ev = await createEvent(page, wallet, "R6 Handover", minute(now + 3600), minute(now + 7200));
  await deposit(hardhat, BOB, ev);
  await deposit(hardhat, CAROL, ev);
  // Alice loads her Luma export: names next to the wallets
  await page.goto(`/organise/${ev}/guests`);
  await wallet.connect("alice");
  await expect(page.getByTestId("guest-row")).toHaveCount(2, { timeout: 30_000 });
  await page.getByTestId("luma-csv").setInputFiles({
    name: "luma.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "api_id,name,email,ticket_name,eth_address,approval_status",
        `p1,Bob Lantern,bob@example.com,Deposit,${BOB},approved`,
        `p2,Carol Lantern,carol@example.com,Deposit,${CAROL},approved`,
      ].join("\n"),
    ),
  });
  await expect(page.getByTestId("guest-row").filter({ hasText: "Bob Lantern" })).toHaveCount(1);
  // after the event: her check-in export and a tick by hand
  await time.setTime(minute(now + 7200) + 120);
  await page.goto(`/organise/${ev}/attendance`);
  await wallet.connect("alice");
  await page.getByTestId("checkin-csv").setInputFiles({
    name: "checkin.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "api_id,name,email,eth_address,checked_in_at,approval_status",
        `c1,Bob Lantern,bob@example.com,${BOB},2026-11-26T20:10:00.000Z,approved`,
        `c2,Carol Lantern,carol@example.com,${CAROL},,approved`,
      ].join("\n"),
    ),
  });
  await expect(page.getByTestId("checkin-loaded")).toBeVisible();
  await page.getByLabel(`${CAROL} came`).check();
  await expect(page.getByLabel(`${BOB} came`)).toBeChecked();

  // the event is handed to Dave: Alice's open page locks within a block or two, not at the next 15 s read
  await call(ALICE, ev, "transferOwnership");
  await call(DAVE, ev, "acceptOwnership");
  await expect(page.getByText("Only the organiser can open this page")).toBeVisible({ timeout: 12_000 });

  // Dave on the same browser: none of Alice's names, exports or ticks
  await wallet.connect(DAVE);
  await expect(page.getByTestId("attendance-row")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId("checkin-loaded")).toHaveCount(0);
  await expect(page.getByLabel(`${BOB} came`)).not.toBeChecked();
  await expect(page.getByLabel(`${CAROL} came`)).not.toBeChecked();
  await expect(page.getByTestId("attendance")).not.toContainText("Lantern");
  await page.goto(`/organise/${ev}/guests`);
  await wallet.connect(DAVE);
  await expect(page.getByTestId("guest-row")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId("guests")).not.toContainText("Lantern");
  await expect(page.getByTestId("luma-loaded")).toHaveCount(0);
  await expect(page.getByTestId("guest-row").first()).toContainText("—");
  // the record names no guest and says who handed the event to whom, in which transaction
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download the record (CSV)" }).click(),
  ]);
  const { readFileSync } = await import("node:fs");
  const text = readFileSync((await download.path())!, "utf8");
  expect(text).not.toContain("Lantern");
  expect(text).toMatch(new RegExp(`Organiser changed,,From ${ALICE} to ${DAVE},`));
  // the overview records it too
  await page.goto(`/organise/${ev}`);
  await wallet.connect(DAVE);
  await expect(page.getByTestId("overview-handover")).toBeVisible({ timeout: 30_000 });

  // Alice is no longer the organiser: nothing of the event, and nothing of her data
  await wallet.connect("alice");
  await expect(page.getByText("Only the organiser can open this page")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("body")).not.toContainText("Lantern");
});
