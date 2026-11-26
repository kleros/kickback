import { connect, getConnectors } from "@wagmi/core";

import { wagmiConfig } from "./wagmi";

/** A wallet has injected a provider into this page (an extension, or the browser inside a wallet app). */
export const hasInjectedWallet = () => typeof window !== "undefined" && "ethereum" in window && !!window.ethereum;

/**
 * The wallets this browser actually has: injected ones (an extension, or the browser inside a
 * wallet app). The generic "injected" entry is dropped when a named wallet announced itself, and
 * when no provider exists at all (it would only fail with "Provider not found").
 */
export function installedWallets() {
  const injected = getConnectors(wagmiConfig).filter((c) => c.type === "injected");
  const named = injected.filter((c) => c.id !== "injected");
  return named.length ? named : injected.filter(hasInjectedWallet);
}

let inFlight = false;

/**
 * One "Connect wallet" press. With exactly one wallet in this browser (always so inside a wallet
 * app's browser on a phone) it connects straight away; otherwise it opens the picker, which lists
 * the installed wallets first and reaches phone wallet apps through WalletConnect.
 */
export async function connectWallet(openPicker: () => unknown) {
  const wallets = typeof window === "undefined" ? [] : installedWallets();
  if (wallets.length !== 1) return void openPicker();
  // a second press while the wallet's prompt is up would send a second request
  if (inFlight) return;
  inFlight = true;
  try {
    await connect(wagmiConfig, { connector: wallets[0]! });
  } catch (error) {
    // declined, already asking, or already connected: stay put; anything else: let the picker offer the other ways in
    const e = error as { code?: number; name?: string; message?: string } | undefined;
    const quiet =
      /reject|denied|cancel|already pending|already connected/i.test(String(e?.message ?? error)) ||
      e?.code === 4001 ||
      e?.code === -32002 ||
      e?.name === "ConnectorAlreadyConnectedError";
    if (!quiet) openPicker();
  } finally {
    inFlight = false;
  }
}
