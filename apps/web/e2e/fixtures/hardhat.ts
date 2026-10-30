import { test as base } from "@playwright/test";
import { createTestClient, http, publicActions, walletActions } from "viem";

import { LOCAL_CHAIN, LOCAL_RPC_URL } from "@/config/chains";

const client = createTestClient({
  chain: LOCAL_CHAIN,
  mode: "hardhat",
  transport: http(LOCAL_RPC_URL),
})
  .extend(publicActions)
  .extend(walletActions);

export type HardhatClient = typeof client;

export const test = base.extend<{ hardhat: HardhatClient }>({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  hardhat: async ({ page }, use) => {
    await use(client);
  },
});
