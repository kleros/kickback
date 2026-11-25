import { connect, getConnectors } from "@wagmi/core";

import { wagmiConfig } from "./wagmi";

/**
 * The wallets this browser actually has: injected ones (an extension, or the browser inside a
 * wallet app). The generic "injected" entry is dropped when a named wallet announced itself.
 */
export function installedWallets() {
  const injected = getConnectors(wagmiConfig).filter((c) => c.type === "injected");
  const named = injected.filter((c) => c.id !== "injected");
  return named.length ? named : injected;
}

/**
 * One "Connect wallet" press. With exactly one wallet in this browser (always so inside a wallet
 * app's browser on a phone) it connects straight away; otherwise it opens the picker, which lists
 * the installed wallets first and reaches phone wallet apps through WalletConnect.
 */
export async function connectWallet(openPicker: () => unknown) {
  const wallets = typeof window === "undefined" ? [] : installedWallets();
  if (wallets.length !== 1) return void openPicker();
  try {
    await connect(wagmiConfig, { connector: wallets[0]! });
  } catch (error) {
    // declined in the wallet: stay put; anything else: let the picker offer the other ways in
    const declined = /reject|denied|cancel/i.test(String((error as Error)?.message ?? error));
    if (!declined) openPicker();
  }
}
