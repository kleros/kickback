"use client";

import { useEffect, useRef, useState } from "react";

import { extractTxHash, normAddress } from "@kickback/core";
import type { Address, Hash } from "viem";
import { usePublicClient } from "wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import type { GuestRow } from "../operations/read";

type Verdict = {
  tone: "ok" | "err" | "warn";
  title: string;
  text?: string;
  /** The paying wallet, shown in full so it can be compared with the Luma request. */
  wallet?: string;
} | null;

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The full address, with the first 6 and last 4 characters stressed: what people compare by eye. */
function WalletText({ wallet }: { wallet: string }) {
  return (
    <span className="og-verdict-wallet">
      <b>{wallet.slice(0, 6)}</b>
      {wallet.slice(6, -4)}
      <b>{wallet.slice(-4)}</b>
    </span>
  );
}

/**
 * One paste from a Luma request (the verified wallet, or the transaction link) → is this a real
 * booking? Remembers what was confirmed in this browser, so one deposit is not approved twice.
 */
export function GuestCheck({
  contract,
  guests,
  nameOf,
  approvedAt,
  check: remember,
}: {
  contract: Address;
  guests: readonly GuestRow[];
  nameOf: (wallet: string) => string | undefined;
  /** When this browser recorded the wallet as approved on Luma. */
  approvedAt: (wallet: string) => number | undefined;
  check: (wallet: string) => number | undefined;
}) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const [text, setText] = useState("");
  const [result, setResult] = useState<Verdict>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef("");
  const input = useRef<HTMLInputElement>(null);

  // the overview's "Check a guest" lands here: ready for the first paste
  useEffect(() => {
    if (window.location.hash === "#check") {
      input.current?.scrollIntoView({ block: "center" });
      input.current?.focus({ preventScroll: true });
    }
  }, []);

  const walletVerdict = (wallet: string, viaTx: boolean): Verdict => {
    const row = guests.find((g) => g.wallet.toLowerCase() === wallet.toLowerCase());
    const name = nameOf(wallet);
    const who = name ? `${name} on Luma. ` : "";
    if (!row || row.status === 0)
      return { tone: "err", title: "No deposit: do not approve", text: "No booking from this wallet.", wallet };
    if (row.status === 2)
      return { tone: "err", title: "Turned away: do not approve", text: "Their deposit was refunded.", wallet };
    if (row.status === 3) return { tone: "err", title: "Refunded: do not approve", wallet };
    const before = approvedAt(wallet);
    if (before !== undefined)
      return {
        tone: "warn",
        title: "Already approved: approve only one",
        text: `${who}A request with this deposit was approved here at ${clock(before)}. One deposit is one ticket.`,
        wallet,
      };
    return {
      tone: "ok",
      title: "Booked: approve",
      text: viaTx
        ? `${who}Approve if this is the Ethereum address on their Luma request.`
        : `${who}Deposit found for this wallet.`,
      wallet,
    };
  };

  const check = async (value: string) => {
    latest.current = value;
    setResult(null);
    const hash = extractTxHash(value);
    if (hash && client) {
      setBusy(true);
      try {
        const tx = await client.getTransaction({ hash: hash as Hash });
        if (latest.current !== value) return;
        if (tx.blockNumber === null)
          return setResult({
            tone: "warn",
            title: "Still confirming: check again in a minute",
            text: "The deposit is sent but not on the blockchain yet.",
          });
        const receipt = await client.getTransactionReceipt({ hash: hash as Hash });
        if (latest.current !== value) return;
        if (receipt.status !== "success")
          return setResult({
            tone: "err",
            title: "Failed transaction: do not approve",
            text: "Nothing was deposited.",
          });
        if (tx.to?.toLowerCase() !== contract.toLowerCase())
          return setResult({
            tone: "err",
            title: "Not a deposit: do not approve",
            text: "This transaction did not go to this event.",
          });
        setResult(walletVerdict(tx.from, true));
      } catch {
        if (latest.current === value)
          setResult({ tone: "err", title: "Not found: do not approve", text: "No such transaction on this network." });
      } finally {
        if (latest.current === value) setBusy(false);
      }
      return;
    }
    setBusy(false);
    const wallet = normAddress(value);
    if (wallet) return setResult(walletVerdict(wallet, false));
    if (value.trim()) setResult({ tone: "warn", title: "Paste a wallet (0x…) or a transaction link" });
  };

  const take = (value: string) => {
    setText(value);
    void check(value);
  };

  const paste = async () => {
    try {
      const value = (await navigator.clipboard.readText()).trim();
      if (value) take(value);
    } catch {
      input.current?.focus();
    }
    input.current?.select();
  };

  return (
    <section className="flex flex-col gap-2" id="check" data-testid="guest-check">
      <h2 className="og-h2">Check a guest</h2>
      <p className="og-lede">
        Paste the Ethereum address Luma verified on the request (safest), or the deposit link they pasted. It is checked
        against this event&apos;s deposits on the blockchain, so a fake link fails.
      </p>
      <div className="og-check-row">
        <input
          ref={input}
          className="og-input is-mono"
          placeholder="0x… or https://etherscan.io/tx/0x…"
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-label="Wallet address or transaction link"
          data-testid="guest-check-input"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => take(e.currentTarget.value)}
        />
        <button type="button" className="og-paste" onClick={() => void paste()}>
          Paste
        </button>
      </div>
      {(busy || result) && (
        <div
          className="og-verdict"
          role="status"
          data-testid="guest-check-result"
          data-tone={busy ? "warn" : result?.tone}
        >
          <p className="og-verdict-title">{busy ? "Checking the transaction…" : result?.title}</p>
          {!busy && result?.wallet && <WalletText wallet={result.wallet} />}
          {!busy && result?.text && <p className="og-verdict-text">{result.text}</p>}
          {!busy && result?.tone === "ok" && result.wallet && result.title !== "Recorded as approved" && (
            <button
              type="button"
              className="og-paste self-start"
              onClick={() => {
                remember(result.wallet!);
                setResult({ ...result, tone: "ok", title: "Recorded as approved", text: "Now approve it on Luma." });
              }}
            >
              I approve it: record
            </button>
          )}
        </div>
      )}
    </section>
  );
}
