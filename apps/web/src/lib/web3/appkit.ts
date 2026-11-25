import { createAppKit } from "@reown/appkit/react";

import { env } from "@/config/env";
import { siteConfig } from "@/config/site";

import { customRpcUrls, defaultNetwork, networks, wagmiAdapter } from "./wagmi";

let instance: ReturnType<typeof createAppKit> | undefined;

export const getAppKit = () =>
  (instance ??= createAppKit({
    adapters: [wagmiAdapter],
    networks,
    defaultNetwork,
    customRpcUrls,
    projectId: env.REOWN_PROJECT_ID,
    metadata: {
      name: siteConfig.name,
      description: siteConfig.description,
      url: env.SITE_URL ?? "http://localhost:3000",
      icons: [],
    },
    enableCoinbase: false,
    // the app shows a wallet on another network itself, with a switch button; AppKit's modal would cover it
    allowUnsupportedChain: true,
    // just wallets: no email or social sign-in, swaps, buying or sending inside the modal
    features: {
      analytics: false,
      email: false,
      socials: false,
      swaps: false,
      onramp: false,
      send: false,
      history: false,
    },
    featuredWalletIds: [
      "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
      "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0", // Trust Wallet
    ],
  }));
