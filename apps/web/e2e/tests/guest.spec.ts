import { kickbackAbi } from "@kickback/contracts";
import { deployLocalEvent } from "@kickback/contracts/local";
import { createWalletClient, getAddress, getContractAddress, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { MOCK_ACCOUNTS } from "@/lib/web3/mock-account";

import { LOCAL_CHAIN, LOCAL_RPC_URL } from "@/config/chains";

import { expect, test, type Page } from "../fixtures";
import { ACCOUNT_PKEYS } from "../utils/accounts";
import { suiteEvent } from "../utils/suiteEvent";

const ticket = (page: Page) => page.getByTestId("ticket");

test.describe("guest event page", () => {
  test("/event opens the live event; legacy and how-it-works links redirect", async ({ page }) => {
    const { contract } = suiteEvent();
    await page.goto("/event");
    await expect(page).toHaveURL(new RegExp(`/event/${contract}$`));

    await page.goto(`/event?contract=${contract}&from=0`);
    await expect(page).toHaveURL(new RegExp(`/event/${contract}\\?from=0$`));
    await expect(ticket(page)).toHaveAttribute("data-state", "rest");

    await page.goto(`/event/${contract}/how-it-works`);
    await expect(page).toHaveURL(new RegExp(`/event/${contract}#how-it-works$`));
    await expect(page.locator("#how-it-works")).toBeInViewport();
  });

  test("a mock wallet connects, deposits, sees pending then done, and copies the transaction link", async ({
    page,
    context,
    wallet,
    hardhat,
  }) => {
    const { contract } = suiteEvent();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/event/${contract}`);
    await expect(ticket(page)).toHaveAttribute("data-state", "rest");
    await expect(ticket(page)).toContainText("10 guests deposited");

    await wallet.connect("alice");
    await expect(ticket(page)).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("wallet-chip")).toBeVisible();

    await hardhat.setAutomine(false);
    try {
      await ticket(page).getByRole("button", { name: "Deposit" }).click();
      await expect(ticket(page)).toHaveAttribute("data-state", "pending");
      await expect(ticket(page)).toContainText("Confirming on Hardhat");
      await expect(ticket(page).getByRole("button", { name: /Confirming/ })).toHaveAttribute("data-pending", "true");
      await hardhat.mine({ blocks: 1 });
    } finally {
      await hardhat.setAutomine(true);
    }

    await expect(ticket(page)).toHaveAttribute("data-state", "done");
    const block = await hardhat.getBlock({ includeTransactions: true });
    const tx = block.transactions.find((t) => t.to?.toLowerCase() === contract.toLowerCase())!;
    expect(tx.from.toLowerCase()).toBe(MOCK_ACCOUNTS.alice.toLowerCase());
    expect(tx.value).toBe(parseEther("0.01"));
    await expect(page.getByTestId("receipt-tx")).toHaveAttribute("title", tx.hash);

    await ticket(page).getByRole("button", { name: "Copy transaction link" }).click();
    await expect(ticket(page).getByRole("button", { name: /Copied/ })).toBeVisible();
    // Hardhat has no block explorer, so the link is the hash itself
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(tx.hash);
  });

  test("wrong network: the wallet is elsewhere, and switching brings it back", async ({ page, wallet }) => {
    await page.goto(`/event/${suiteEvent().contract}`);
    await wallet.connect("bob");
    await expect(ticket(page)).toHaveAttribute("data-state", "ready");

    await page.evaluate(() => window.__setMockChainId!(42161));
    await expect(ticket(page)).toHaveAttribute("data-state", "wrongnet");
    await expect(ticket(page)).toContainText("Your wallet is on Arbitrum One.");

    await ticket(page).getByRole("button", { name: "Switch to Hardhat" }).click();
    await expect(ticket(page)).toHaveAttribute("data-state", "ready");
  });

  test("insufficient: a wallet short of deposit plus fee cannot deposit", async ({ page, wallet, hardhat }) => {
    const poor = getAddress("0x00000000000000000000000000000000000bee01");
    await hardhat.setBalance({ address: poor, value: parseEther("0.005") });
    await page.goto(`/event/${suiteEvent().contract}`);
    await wallet.connect(poor);
    await expect(ticket(page)).toHaveAttribute("data-state", "insufficient");
    await expect(ticket(page)).toContainText("0.005 ETH available");
    await expect(ticket(page).getByRole("button", { name: "Not enough ETH" })).toBeDisabled();
  });

  test("deposits close once the chain passes eventStart", async ({ page, hardhat, time }) => {
    const walletClient = createWalletClient({
      chain: LOCAL_CHAIN,
      transport: http(LOCAL_RPC_URL),
      account: privateKeyToAccount(ACCOUNT_PKEYS.alice),
    });
    const now = await time.getHardhatTime();
    const { event } = await deployLocalEvent({
      walletClient,
      publicClient: hardhat as never,
      eventStart: BigInt(now + 600),
    });

    await page.goto(`/event/${event}`);
    await expect(ticket(page)).toHaveAttribute("data-state", "rest");
    await time.advanceTime(1200);
    await expect(ticket(page)).toHaveAttribute("data-state", "closed");
    await expect(ticket(page).getByRole("button", { name: "Deposits closed" })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Deposit 0\.01 ETH/ })).toHaveCount(0);
  });

  test("refuses a contract that is not Kickback, and an address with no contract", async ({ page }) => {
    // the suite's first deploy: MockKlerosLiquid, a contract that is not an event
    const arbitrator = getContractAddress({ from: MOCK_ACCOUNTS.alice, nonce: 0n });
    await page.goto(`/event/${arbitrator}`);
    await expect(page.getByRole("heading", { name: "Not a Kickback event" })).toBeVisible();
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-reason", "not-kickback");
    await expect(ticket(page)).toHaveCount(0);

    await page.goto("/event/0x000000000000000000000000000000000000dEaD");
    await expect(page.getByTestId("refusal")).toHaveAttribute("data-reason", "no-contract");
  });

  test("how it works: the split matches previewShare, and deadlines are on the event's clock", async ({
    page,
    hardhat,
  }) => {
    const { contract } = suiteEvent();
    await page.goto(`/event/${contract}`);
    const sum = page.getByTestId("how-sum");
    await expect(sum).toBeVisible();
    const attend = Number(await sum.getAttribute("data-attend"));
    expect(attend).toBe(8);
    const preview = await hardhat.readContract({
      address: contract,
      abi: kickbackAbi,
      functionName: "previewShare",
      args: [BigInt(attend)],
    });
    await expect(sum).toHaveAttribute("data-back", preview.toString());
    await expect(sum).toContainText("0.01 + 0.0025 = 0.0125 ETH");

    await expect(page.getByTestId("event-when")).toContainText("IST");
    const deadlines = page.getByTestId("how-deadlines");
    await expect(deadlines).toContainText("IST");
    await expect(deadlines).toContainText("your time");

    await page.getByRole("button", { name: /^Deposit 0\.01 ETH/ }).click();
    await expect(ticket(page)).toBeInViewport();
  });

  test("reduced motion leaves no running animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/event/${suiteEvent().contract}`);
    await expect(ticket(page)).toHaveAttribute("data-state", "rest");
    await page.locator("#how-it-works").scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 4000);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document
            .getAnimations()
            .filter((a) => a.playState === "running")
            .map((a) => (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "animation"),
        ),
      )
      .toEqual([]);
  });
});
