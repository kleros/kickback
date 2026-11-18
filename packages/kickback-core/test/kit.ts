// Viem clients over the Hardhat node globalSetup starts, with Hardhat's default accounts.
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { inject } from "vitest";

const MNEMONIC = "test test test test test test test test test test test junk";
/** Hardhat's default accounts (10,000 ETH each). */
export const accounts = Array.from({ length: 10 }, (_, i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));

export function chainKit() {
  const rpcUrl = inject("rpcUrl");
  const transport = http(rpcUrl);
  const client = createPublicClient({ chain: hardhat, transport, cacheTime: 0, pollingInterval: 50 }) as PublicClient;
  const testClient = createTestClient({ chain: hardhat, mode: "hardhat", transport });
  const wallets = accounts.map((account) => createWalletClient({ account, chain: hardhat, transport }));
  const wallet = (i: number) => wallets[i]!;
  const addr = (i: number): Address => accounts[i]!.address;
  const mined = async (hash: Hash) => {
    const r = await client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
    if (r.status !== "success") throw new Error(`tx ${hash} reverted`);
    return r;
  };
  const warp = async (seconds: number) => {
    await testClient.increaseTime({ seconds });
    await testClient.mine({ blocks: 1 });
  };
  return { client, wallet, addr, mined, warp };
}
