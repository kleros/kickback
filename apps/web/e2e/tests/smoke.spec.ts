import { privateKeyToAddress } from "viem/accounts";

import { shortenAddress } from "@/utils/address";

import { MOCK_ACCOUNTS, type MockAccountName } from "@/lib/web3/mock-account";

import { expect, test } from "../fixtures";
import { ACCOUNT_PKEYS } from "../utils/accounts";

const DAY = 24 * 60 * 60;

test("the app loads, a mock account connects, and the chain clock follows the chain", async ({
  page,
  wallet,
  time,
  hardhat,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Kickback" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();

  await wallet.connect("alice");
  await expect(page.getByText(shortenAddress(MOCK_ACCOUNTS.alice))).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect" })).toHaveCount(0);

  const clock = page.getByTestId("chain-time");
  const before = await time.getHardhatTime();
  await expect(clock).toHaveAttribute("data-unix", String(before));

  // the chain alone moves a day ahead; the browser clock stays put, so only chain time can match
  await hardhat.increaseTime({ seconds: DAY });
  await hardhat.mine({ blocks: 1 });
  const after = await time.getHardhatTime();
  expect(after - before).toBeGreaterThanOrEqual(DAY);
  expect(Math.abs(after - (await page.evaluate(() => Math.floor(Date.now() / 1000))))).toBeGreaterThan(DAY / 2);

  await expect(clock).toHaveAttribute("data-unix", String(after));
});

test("account keys and addresses have not drifted apart", () => {
  for (const [name, privateKey] of Object.entries(ACCOUNT_PKEYS)) {
    expect(privateKeyToAddress(privateKey)).toBe(MOCK_ACCOUNTS[name as MockAccountName]);
  }
});
