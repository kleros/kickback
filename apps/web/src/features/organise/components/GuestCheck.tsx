"use client";

import { useEffect, useRef, useState } from "react";

import { presenceEventAbi } from "@kickback/contracts";
import { extractTxHash, normAddress } from "@kickback/core";
import { useQueryClient } from "@tanstack/react-query";
import {
  isAddressEqual,
  parseEventLogs,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hash,
} from "viem";
import { usePublicClient } from "wagmi";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { organiserKey } from "../hooks/useOrganiserEvent";
import { when } from "../model/view";
import type { GuestRow } from "../operations/read";

type Verdict = {
  tone: "ok" | "err" | "warn";
  title: string;
  text?: string;
  /** The paying wallet, shown in full so it can be compared with the Luma request. */
  wallet?: string;
  /** Nothing left to record: the "I approved them on Luma" button is hidden. */
  done?: boolean;
} | null;

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
  lumaOf,
  approvedAt,
  check: remember,
  closed,
  ended,
  statusOf,
}: {
  contract: Address;
  guests: readonly GuestRow[];
  nameOf: (wallet: string) => string | undefined;
  /** The wallet's request status in the latest Luma export loaded here. */
  lumaOf?: (wallet: string) => "approved" | "pending" | "declined" | undefined;
  /** The event no longer takes approvals: cancelled, or the deadline to confirm who came was missed. */
  closed?: "cancelled" | "missed";
  /** The event has ended (or its list is closed, or it is paid out): nothing is left to approve on Luma. */
  ended?: boolean;
  /** The wallet's status as the guest list shows it ("Came", "Not on the list", "With Kleros"). */
  statusOf?: (wallet: string) => string | undefined;
  /** When this browser recorded the wallet as approved on Luma. */
  approvedAt: (wallet: string) => number | undefined;
  check: (wallet: string) => number | undefined;
}) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const queries = useQueryClient();
  const [text, setText] = useState("");
  // verdicts with no wallet are kept as they are; a wallet's verdict is worked out on each render, so a Luma
  // export loaded later, an approval from another tab or a disconnect shows at once
  const [fixed, setResult] = useState<Verdict>(null);
  const [checked, setChecked] = useState<{ wallet: string; viaTx: boolean; live?: number; marked?: boolean } | null>(
    null,
  );
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

  /**
   * `live` is the wallet's status read from the contract at check time; `cached` is the refreshed list. A status
   * only moves forward (none, deposited, then turned away or refunded), so the later of the two readings wins.
   */
  const walletVerdict = (wallet: string, viaTx: boolean, live?: number): Verdict => {
    const cached = guests.find((g) => g.wallet.toLowerCase() === wallet.toLowerCase())?.status;
    const status = Math.max(live ?? 0, cached ?? 0);
    // once the event is over there is nothing to approve: the titles state the fact, not an instruction
    if (status === 0)
      return {
        tone: "err",
        title: ended ? "No deposit" : "No deposit: do not approve",
        text: "This wallet did not deposit.",
        wallet,
      };
    if (status === 2)
      return {
        tone: "err",
        title: ended ? "Turned away" : "Turned away: do not approve",
        text: "Their deposit was refunded.",
        wallet,
      };
    if (status === 3)
      return {
        tone: "err",
        title: ended ? "Refunded" : "Refunded: do not approve",
        text: "This wallet withdrew its deposit.",
        wallet,
      };
    const before = approvedAt(wallet);
    if (before !== undefined)
      return {
        tone: "warn",
        title: "Already approved: approve only one",
        text: `A request with this deposit was already approved here on ${when(Math.floor(before / 1000))}. One deposit covers one guest.`,
        wallet,
        done: true,
      };
    if (closed)
      return {
        tone: "warn",
        title: closed === "cancelled" ? "Event cancelled: do not approve" : "Deadline missed: do not approve",
        text:
          closed === "cancelled"
            ? "This event is cancelled, so this guest can withdraw their full deposit on the guest page."
            : "Attendance was not confirmed in time, so this guest can withdraw their full deposit on the guest page.",
        wallet,
      };
    if (ended)
      return {
        tone: "warn",
        title: "Event over: no approval needed",
        text: `Status: ${statusOf?.(wallet) ?? "Deposited"}.`,
        wallet,
        done: true,
      };
    if (lumaOf?.(wallet) === "approved")
      return {
        tone: "ok",
        title: "Deposit found: already approved on Luma",
        text: "Nothing to do. Do not approve a second request with this deposit.",
        wallet,
        done: true,
      };
    return {
      tone: "ok",
      title: "Deposit found: approve",
      text: viaTx
        ? "Approve if this is the Ethereum address on their Luma request, then mark it below."
        : "Approve their request on Luma, then mark it below.",
      wallet,
    };
  };

  // the deposit is read live: the cached list can be seconds behind a walk-in who just deposited
  const liveStatus = async (wallet: Address) =>
    client
      ? Number(
          await client.readContract({
            address: contract,
            abi: presenceEventAbi,
            functionName: "status",
            args: [wallet],
          }),
        )
      : undefined;

  const check = async (value: string) => {
    latest.current = value;
    setResult(null);
    setChecked(null);
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
            text: "The deposit was sent but is not on the blockchain yet.",
          });
        const receipt = await client.getTransactionReceipt({ hash: hash as Hash });
        if (latest.current !== value) return;
        if (receipt.status !== "success")
          return setResult({
            tone: "err",
            title: "Failed transaction: do not approve",
            text: "Nothing was deposited.",
          });
        // the depositor is in the event's own Deposited log: smart wallets and Safes send through another contract
        const stakers = [
          ...new Set(
            parseEventLogs({
              abi: presenceEventAbi,
              eventName: "Deposited",
              logs: receipt.logs.filter((l) => isAddressEqual(l.address, contract)),
            }).map((l) => l.args.staker),
          ),
        ];
        if (stakers.length === 0)
          return setResult({
            tone: "err",
            title: "Not a deposit: do not approve",
            text: "This transaction has no deposit to this event.",
          });
        if (stakers.length > 1)
          return setResult({
            tone: "warn",
            title: "Several deposits in one transaction",
            text: "Paste the Ethereum address from their Luma request instead.",
          });
        const staker = stakers[0]!;
        const status = await liveStatus(staker);
        if (latest.current !== value) return;
        setChecked({ wallet: staker, viaTx: true, live: status });
        void queries.invalidateQueries({ queryKey: organiserKey(contract) });
      } catch (e) {
        if (latest.current === value)
          setResult(
            e instanceof TransactionNotFoundError || e instanceof TransactionReceiptNotFoundError
              ? { tone: "err", title: "Not found: do not approve", text: "No such transaction on this network." }
              : { tone: "warn", title: "Could not check: try again", text: "The network did not answer." },
          );
      } finally {
        if (latest.current === value) setBusy(false);
      }
      return;
    }
    setBusy(false);
    const wallet = normAddress(value);
    if (wallet) {
      setBusy(true);
      try {
        const status = await liveStatus(wallet as Address);
        if (latest.current === value) setChecked({ wallet, viaTx: false, live: status });
      } catch {
        // the network did not answer: the list read a few seconds ago still counts
        if (latest.current === value) setChecked({ wallet, viaTx: false });
      } finally {
        if (latest.current === value) setBusy(false);
      }
      return;
    }
    if (value.trim()) setResult({ tone: "warn", title: "Paste a wallet address (0x…) or a deposit link" });
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

  const verdict = checked ? walletVerdict(checked.wallet, checked.viaTx, checked.live) : null;
  // a guest turned away or refunded after the mark is no longer approved
  const result: Verdict = checked
    ? checked.marked && verdict?.tone !== "err"
      ? {
          tone: "ok",
          title: "Marked as approved",
          text: "Saved in this browser only, so this deposit is not approved twice.",
          wallet: checked.wallet,
          done: true,
        }
      : verdict
    : fixed;

  return (
    <section className="flex flex-col gap-2" id="check" data-testid="guest-check">
      <h2 className="og-h2">Check a guest</h2>
      <p className="og-lede">
        Paste the Ethereum address Luma verified on the request (safest), or the deposit link the guest pasted. It is
        checked against this event&apos;s deposits on the blockchain, so a fake link fails.
      </p>
      <div className="og-check-row">
        <input
          ref={input}
          className="og-input is-mono"
          placeholder="0x… or deposit link"
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-label="Wallet address or deposit link"
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
          <p className="og-verdict-title">
            {busy ? (extractTxHash(text) ? "Checking the transaction…" : "Checking the deposit…") : result?.title}
          </p>
          {!busy && result?.wallet && <WalletText wallet={result.wallet} />}
          {!busy && result?.text && (
            <p className="og-verdict-text">
              {/* the name is read now, not kept in the verdict: it disappears at once on Disconnect */}
              {result.tone !== "err" && result.wallet && nameOf(result.wallet)
                ? `Luma name: ${nameOf(result.wallet)}. `
                : ""}
              {result.text}
            </p>
          )}
          {!busy && result?.tone === "ok" && result.wallet && !result.done && (
            <button
              type="button"
              className="og-paste self-start"
              onClick={() => {
                remember(result.wallet!);
                setChecked((c) => (c ? { ...c, marked: true } : c));
              }}
            >
              I approved them on Luma
            </button>
          )}
        </div>
      )}
    </section>
  );
}
