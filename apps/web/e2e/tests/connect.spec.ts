import { MOCK_ACCOUNTS } from "@/lib/web3/mock-account";

import { expect, test } from "../fixtures";

// a wallet app's browser on a phone: the one-tap connect is only taken on a phone
test.use({
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

/** Inside a wallet app's browser (one injected wallet) "Connect" connects in one tap, with no picker. */
test("one tap connects the only wallet in this browser", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((account) => {
    let accounts: string[] = [];
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      request: async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") {
          accounts = [account];
          (listeners.accountsChanged ?? []).forEach((f) => f(accounts));
          return accounts;
        }
        if (method === "eth_accounts") return accounts;
        if (method === "eth_chainId") return "0x7a69";
        if (method === "net_version") return "31337";
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
        throw new Error(`unsupported ${method}`);
      },
      on: (event: string, f: (...a: unknown[]) => void) => {
        (listeners[event] ??= []).push(f);
      },
      removeListener: () => {},
    };
  }, MOCK_ACCOUNTS.bob);
  await page.goto("/organise/new");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByTestId("wallet-chip")).toBeVisible({ timeout: 15_000 });
});
