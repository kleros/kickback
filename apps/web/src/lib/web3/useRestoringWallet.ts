"use client";

import { useEffect, useState } from "react";

import { useAccount } from "wagmi";

/** A connection that wagmi saved in its cookie (`wagmi.store`) and will try to restore on load. */
function hasSavedSession() {
  try {
    const raw = document.cookie
      .split("; ")
      .find((c) => c.startsWith("wagmi.store="))
      ?.slice("wagmi.store=".length);
    if (!raw) return false;
    const current = (JSON.parse(decodeURIComponent(raw)) as { state?: { current?: string | null } }).state?.current;
    return typeof current === "string" && current.length > 0;
  } catch {
    return false;
  }
}

/**
 * True while a saved wallet may still be reconnecting on page load. wagmi reports "disconnected" until its
 * reconnect starts (and in the server HTML), so a bare `status === "reconnecting"` lets a Connect button flash.
 * Until the page has mounted the answer is unknown and counts as restoring; after that, a saved session counts
 * until wagmi has had its try (or 4 s have passed).
 */
export function useRestoringWallet() {
  const { address, status } = useAccount();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setSaved(hasSavedSession());
    const timer = setTimeout(() => setTried(true), 4_000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (status === "reconnecting" || status === "connected") setTried(true);
  }, [status]);
  if (address) return false;
  if (status === "reconnecting") return true;
  if (saved === null) return true;
  return saved && !tried;
}
