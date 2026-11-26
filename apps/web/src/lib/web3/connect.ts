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
 * Inside a wallet app's own browser on a phone: one injected wallet that is not a browser's built-in one
 * (Brave Wallet and Opera's wallet are injected even when the guest keeps their funds in a phone wallet app).
 */
function inWalletApp() {
  if (!/Android|iPhone|iPad|Mobi/i.test(navigator.userAgent) || !hasInjectedWallet()) return false;
  const provider = (window as unknown as { ethereum?: { isBraveWallet?: boolean; isOpera?: boolean } }).ethereum;
  return !(provider?.isBraveWallet || provider?.isOpera);
}

/**
 * One "Connect wallet" press. Inside a wallet app's browser on a phone (exactly one wallet, not a
 * browser's built-in one) it connects straight away. Everywhere else it opens the picker, which lists
 * the installed wallets first and also reaches phone wallet apps through WalletConnect. A decline in
 * the wallet also opens the picker, so the other ways in stay one tap away.
 */
export async function connectWallet(openPicker: () => unknown) {
  const wallets = typeof window === "undefined" ? [] : installedWallets();
  if (wallets.length !== 1 || !inWalletApp()) return void openPicker();
  // a second press while the wallet's prompt is up would send a second request
  if (inFlight) return;
  inFlight = true;
  try {
    await connect(wagmiConfig, { connector: wallets[0]! });
  } catch (error) {
    // already asking or already connected: stay put; declined or anything else: let the picker offer the other ways in
    const e = error as { code?: number; name?: string; message?: string } | undefined;
    const quiet =
      /already pending|already connected/i.test(String(e?.message ?? error)) ||
      e?.code === -32002 ||
      e?.name === "ConnectorAlreadyConnectedError";
    if (!quiet) openPicker();
  } finally {
    inFlight = false;
  }
}
