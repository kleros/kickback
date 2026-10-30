"use client";

import { useEffect, type ReactNode } from "react";

import { WagmiProvider } from "wagmi";

import { getAppKit } from "@/lib/web3/appkit";
import { installMockWallet } from "@/lib/web3/mock-wallet";
import { wagmiConfig } from "@/lib/web3/wagmi";

export default function Web3Providers({ children }: { children: ReactNode }) {
  getAppKit();

  useEffect(installMockWallet, []);

  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}
