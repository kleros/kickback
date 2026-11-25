import { privateKeyToAddress } from "viem/accounts";

import { shortenAddress } from "@/utils/address";

import { MOCK_ACCOUNTS, type MockAccountName } from "@/lib/web3/mock-account";

import { expect, test } from "../fixtures";
import { ACCOUNT_PKEYS } from "../utils/accounts";

test("the landing loads, links to create, and a mock account connects", async ({ page, wallet }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Turn sign-ups into guests/ })).toBeVisible();
  await expect(page.getByTestId("home-create")).toHaveAttribute("href", "/organise/new");
  await expect(page.getByTestId("home-event")).not.toHaveCount(0);

  await wallet.connect("alice");
  await expect(page.getByText(shortenAddress(MOCK_ACCOUNTS.alice))).toBeVisible();

  // the header chip opens a menu that disconnects
  await page.getByTestId("wallet-chip").click();
  await page.getByTestId("disconnect").click();
  await expect(page.getByTestId("wallet-chip")).toHaveCount(0);
});

test("account keys and addresses have not drifted apart", () => {
  for (const [name, privateKey] of Object.entries(ACCOUNT_PKEYS)) {
    expect(privateKeyToAddress(privateKey)).toBe(MOCK_ACCOUNTS[name as MockAccountName]);
  }
});
