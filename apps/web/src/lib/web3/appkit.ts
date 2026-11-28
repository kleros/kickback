import { createAppKit } from "@reown/appkit/react";

import { env } from "@/config/env";
import { siteConfig } from "@/config/site";

import { customRpcUrls, defaultNetwork, networks, wagmiAdapter } from "./wagmi";

const siteUrl = () =>
  env.SITE_URL ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

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
      url: siteUrl(),
      // wallets show this on the connect and sign prompts; many cannot draw SVG
      icons: [new URL("/img/kleros-symbol-512.png", siteUrl()).href],
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
  }));
