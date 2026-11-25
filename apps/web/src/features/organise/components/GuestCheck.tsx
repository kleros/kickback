"use client";

import { useRef, useState } from "react";

import { extractTxHash, normAddress } from "@kickback/core";
import type { Address, Hash } from "viem";
import { usePublicClient } from "wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { shortHex } from "../model/view";
import type { GuestRow } from "../operations/read";

type Result = { tone: "ok" | "err" | "warn"; text: string } | null;

const STATUS: Record<number, Result> = {
  1: { tone: "ok", text: "Deposit found: booked. Approve on Luma." },
  2: { tone: "err", text: "Turned away: their deposit was refunded. Do not approve." },
  3: { tone: "err", text: "Refunded. Do not approve." },
};

/** One paste from Luma (the verified wallet, or the transaction link) → is this a real booking? */
export function GuestCheck({ contract, guests }: { contract: Address; guests: readonly GuestRow[] }) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef("");
  const byWallet = (wallet: string) => guests.find((g) => g.wallet.toLowerCase() === wallet.toLowerCase());
  const walletResult = (wallet: string): Result =>
    STATUS[byWallet(wallet)?.status ?? 0] ?? {
      tone: "err",
      text: `No deposit from ${shortHex(wallet)} for this event. Do not approve.`,
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
        if (tx.to?.toLowerCase() !== contract.toLowerCase())
          return setResult({ tone: "err", text: "This transaction is not a deposit into this event. Do not approve." });
        const outcome = walletResult(tx.from);
        setResult(
          outcome?.tone === "ok"
            ? {
                tone: "ok",
                text: `Deposit found from ${shortHex(tx.from)}. Approve only if this is the Ethereum address on their Luma request.`,
              }
            : outcome,
        );
      } catch {
        setResult({ tone: "err", text: "No such transaction on this network. Do not approve." });
      } finally {
        setBusy(false);
      }
      return;
    }
    const wallet = normAddress(value);
    if (wallet) return setResult(walletResult(wallet));
    if (value.trim()) setResult({ tone: "warn", text: "Paste a wallet address (0x…) or a transaction link." });
  };

  return (
    <section className="flex flex-col gap-2" data-testid="guest-check">
      <h2 className="og-h2">Check a Luma request</h2>
      <p className="og-lede">
        Paste the guest&apos;s Ethereum address or transaction link from their Luma request. It is checked against this
        event&apos;s deposits on the blockchain, so a fake or random link fails.
      </p>
      <input
        className="og-input is-mono"
        placeholder="0x… or https://etherscan.io/tx/0x…"
        value={text}
        spellCheck={false}
        autoComplete="off"
        aria-label="Wallet address or transaction link"
        data-testid="guest-check-input"
        onChange={(event) => {
          const value = event.currentTarget.value;
          setText(value);
          void check(value);
        }}
      />
      {(busy || result) && (
        <p className="og-cell-status" data-testid="guest-check-result" data-tone={result?.tone}>
          <span className="og-dot" data-tone={busy ? "warn" : result?.tone} aria-hidden />
          <span>{busy ? "Checking the transaction…" : result?.text}</span>
        </p>
      )}
    </section>
  );
}
