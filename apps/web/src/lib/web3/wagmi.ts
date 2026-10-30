import { hardhat, mainnet, sepolia, type AppKitNetwork } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { cookieStorage, createStorage } from "wagmi";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID, isLocalChainEnabled, isSepolia, MAINNET_DEFAULT_RPC } from "@/config/chains";
import { env } from "@/config/env";
import { transports } from "@/config/rpc";

/** The one network the app runs on, chosen by NEXT_PUBLIC_CHAIN, with the RPC `config/chains` gave it. */
export const defaultNetwork: AppKitNetwork = {
  ...(isLocalChainEnabled ? hardhat : isSepolia ? sepolia : mainnet),
  rpcUrls: DEFAULT_CHAIN.rpcUrls,
};

if (defaultNetwork.id !== DEFAULT_CHAIN_ID) {
  throw new Error(`Chain config drift: AppKit default network is ${defaultNetwork.id}, expected ${DEFAULT_CHAIN_ID}`);
}

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [defaultNetwork];

const defaultRpc: string | undefined = DEFAULT_CHAIN.rpcUrls.default.http[0];

// Signing through the mock connector goes to the network's default RPC, which AppKit
// otherwise points at its own Blockchain API instead of the configured transport.
export const customRpcUrls =
  defaultRpc && defaultRpc !== MAINNET_DEFAULT_RPC
    ? { [`eip155:${DEFAULT_CHAIN_ID}` as const]: [{ url: defaultRpc }] }
    : undefined;

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId: env.REOWN_PROJECT_ID,
  transports,
  customRpcUrls,
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  batch: { multicall: true },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
