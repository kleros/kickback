"use client";

import { forwardRef, useEffect, useState } from "react";

import { Button, Link } from "react-aria-components";
import type { Address } from "viem";

import { CopyButton, CopyPrimaryButton } from "@/components/ui/CopyButton";
import { Disclosure } from "@/components/ui/Disclosure";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";
import { CheckIcon, ExternalIcon, ShieldCheckIcon } from "@/components/ui/icons";
import { NumberPop } from "@/components/ui/NumberPop";
import { TextSwap } from "@/components/ui/TextSwap";

import type { DepositView, StatusLine } from "../model/depositState";

export interface TicketActions {
  connect: () => void;
  switchChain: () => void;
  addChain: () => void;
  deposit: () => void;
  withdraw: () => void;
  claim: () => void;
  challenge: () => void;
  approve: () => void;
  resolve: () => void;
  release: () => void;
  execute: () => void;
  settle: () => void;
  recheck: () => void;
}

export interface VerifiedFacts {
  contract: Address;
  factory: Address;
  disputeResolver: Address;
  arbitrator: Address;
  explorer?: string;
  court: string;
}

export interface TicketCardProps {
  view: DepositView;
  /** "0.01": the deposit, without the unit. */
  amount: string;
  /** The deposit's asset: "ETH", "USDC". */
  unit: string;
  actions: TicketActions;
  verified: VerifiedFacts;
  lumaUrl?: string;
  /** Play the load moment: rise in, digits pop in. */
  entrance?: boolean;
}

const short = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;

function ExplorerLink({ explorer, address, label }: { explorer?: string; address: string; label: string }) {
  if (!explorer) return null;
  return (
    <Link
      className="kb-icon-btn is-small"
      href={`${explorer}/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
    >
      <ExternalIcon />
    </Link>
  );
}

function Line({ line, onRecheck }: { line: StatusLine; onRecheck: () => void }) {
  return (
    <p className={line.tone}>
      {line.text}
      {line.link && (
        <>
          {line.text ? " · " : ""}
          {line.link.href.startsWith("/") ? (
            // a page of this site opens in the same tab
            <Link className="kb-link" href={line.link.href}>
              {line.link.label}
            </Link>
          ) : (
            <Link className="kb-link" href={line.link.href} target="_blank" rel="noopener noreferrer">
              {line.link.label}
            </Link>
          )}
        </>
      )}
      {line.link2 && (
        <>
          {" · "}
          <Link className="kb-link" href={line.link2.href} target="_blank" rel="noopener noreferrer">
            {line.link2.label}
          </Link>
        </>
      )}
      {line.action && (
        <>
          {" · "}
          <Button className="kb-link tk-inline" onPress={onRecheck}>
            {line.action.label}
          </Button>
        </>
      )}
    </p>
  );
}

/** Holds a state's error shake for one play, then clears it so the next error can replay it. */
function useShake(trigger: string | undefined) {
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (!trigger) return;
    setShaking(true);
    const timer = setTimeout(() => setShaking(false), 420);
    return () => clearTimeout(timer);
  }, [trigger]);
  return shaking;
}

/** The deposit ticket: amount biggest, one action, a two-line status slot, at one height in every state. */
export const TicketCard = forwardRef<HTMLElement, TicketCardProps>(function TicketCard(
  { view, amount, unit, actions, verified, lumaUrl, entrance = false },
  ref,
) {
  const shownAmount = view.amount ?? amount;
  const done = view.key === "done" || view.key === "already";
  const shaking = useShake(view.shake ? `${view.key}:${view.lines[0]?.text}` : undefined);
  // the browser refused to copy (common in wallet in-app browsers): show the link to copy by hand
  const [copyFailed, setCopyFailed] = useState(false);
  const copyValue = view.receipt?.txLink ?? view.copy;
  useEffect(() => setCopyFailed(false), [copyValue]);
  // a blocked clipboard (wallet in-app browsers): show the text to copy by hand, in the slot's own two rows
  const manualCopy = copyFailed && (view.receipt !== undefined || view.copy !== undefined);
  const copyIsLink = view.receipt !== undefined || (view.copy?.includes("/") ?? false);

  const press = {
    connect: actions.connect,
    switch: actions.switchChain,
    "add-chain": actions.addChain,
    deposit: actions.deposit,
    withdraw: actions.withdraw,
    claim: actions.claim,
    challenge: actions.challenge,
    approve: actions.approve,
    resolve: actions.resolve,
    release: actions.release,
    execute: actions.execute,
    settle: actions.settle,
    copy: () => {},
    none: () => {},
  }[view.action];

  return (
    <GlassCard
      ref={ref}
      as="section"
      interactive
      aria-label="Deposit"
      className={`kb-ticket${entrance ? " kb-rise" : ""}`}
      data-state={view.key}
      data-stage={view.stage}
      data-testid="ticket"
    >
      <div className="tk-label">
        <TextSwap>{view.label}</TextSwap>
      </div>
      <div className="tk-hero">
        <NumberPop
          value={shownAmount}
          still={!entrance}
          className={shownAmount.length > 10 ? "tk-amount is-precise" : "tk-amount"}
        />
        <span className="tk-unit">{view.unit ?? unit}</span>
        {done && (
          <span className="tk-done t-success-check" data-state="in" aria-hidden>
            <CheckIcon size={26} strokeWidth={2.25} />
          </span>
        )}
      </div>
      <hr className="tk-hair" />
      <div
        className={`tk-slot${shaking ? " is-shaking" : ""}${view.receipt && view.lines.length ? " has-receipt-note" : ""}`}
        aria-live="polite"
        data-testid="ticket-status"
      >
        {view.receipt ? (
          <>
            <div className="tk-rcpt">
              <span className="k">Transaction</span>
              {copyFailed ? (
                <span className="v kb-mono tk-select" data-testid="receipt-tx">
                  {view.receipt.txLink}
                </span>
              ) : (
                <span className="v kb-mono" title={view.receipt.tx} data-testid="receipt-tx">
                  {short(view.receipt.tx)}
                  {view.receipt.when ? ` · ${view.receipt.when}` : ""}
                </span>
              )}
              <span className="acts">
                {view.receipt.txUrl && (
                  <Link
                    className="kb-icon-btn is-small"
                    href={view.receipt.txUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open the transaction"
                  >
                    <ExternalIcon />
                  </Link>
                )}
              </span>
            </div>
            <div className="tk-rcpt">
              <span className="k">Wallet</span>
              <span className="v kb-mono" title={view.receipt.wallet}>
                {short(view.receipt.wallet)}
              </span>
              <span className="acts">
                <CopyButton value={view.receipt.wallet} label="Copy wallet address" />
              </span>
            </div>
          </>
        ) : null}
        {view.lines.map((line, i) =>
          i === 1 && copyFailed && !view.receipt && view.copy ? (
            <div className="tk-rcpt" key={i}>
              <span className="k">{copyIsLink ? "Wallet link" : "Wallet"}</span>
              <span className="v kb-mono tk-select" data-testid="copy-text">
                {view.copy}
              </span>
              <span className="acts" />
            </div>
          ) : (
            <Line key={i} line={line} onRecheck={actions.recheck} />
          ),
        )}
      </div>
      <div className="tk-btn">
        {view.action === "copy" && copyValue ? (
          <CopyPrimaryButton value={copyValue} onFailed={() => setCopyFailed(true)}>
            {view.button}
          </CopyPrimaryButton>
        ) : view.status ? (
          <div className="tk-status" data-testid="ticket-state">
            {view.button}
          </div>
        ) : (
          <GradientButton
            wide
            glyph={view.glyph}
            isPending={view.glyph !== undefined}
            isDisabled={view.disabled}
            onPress={press}
          >
            {view.button}
          </GradientButton>
        )}
      </div>
      <div className="tk-foot">
        {manualCopy ? (
          <span>{copyIsLink ? "Press and hold the link to copy." : "Press and hold the address to copy."}</span>
        ) : (
          view.foot && <span>{view.foot}</span>
        )}
        {done && !view.ended && lumaUrl && (
          <>
            {(view.foot || manualCopy) && (
              <span className="tk-sep" aria-hidden>
                ·
              </span>
            )}
            <Link className="kb-link" href={lumaUrl} target="_blank" rel="noopener noreferrer">
              Back to Luma
              <ExternalIcon size={14} />
            </Link>
          </>
        )}
      </div>
      <div className="tk-verified">
        <Disclosure title="Proof of Presence contract" icon={<ShieldCheckIcon className="ok" />}>
          <div className="tk-vrows">
            <p className="tk-vnote">
              This event was created by this site&apos;s official factory, and its disputes go to Kleros Court. This
              checks the code, not the organiser: anyone can create an event, so only use the link from the
              organiser&apos;s Luma event page.
            </p>
            <div className="tk-vrow">
              <span>Code</span>
              <span>
                Proof of Presence factory&nbsp;
                <span className="kb-mono whitespace-nowrap">{short(verified.factory)}</span>
                <ExplorerLink explorer={verified.explorer} address={verified.factory} label="Open the factory" />
              </span>
            </div>
            <div className="tk-vrow">
              <span>Disputes</span>
              <span>{verified.court}</span>
            </div>
            <div className="tk-vrow">
              <span>Dispute resolver</span>
              <span className="kb-mono">
                {short(verified.disputeResolver)}
                <ExplorerLink
                  explorer={verified.explorer}
                  address={verified.disputeResolver}
                  label="Open the dispute resolver"
                />
              </span>
            </div>
            <div className="tk-vrow">
              <span>Arbitrator</span>
              <span className="kb-mono">
                {short(verified.arbitrator)}
                <ExplorerLink explorer={verified.explorer} address={verified.arbitrator} label="Open the arbitrator" />
              </span>
            </div>
            <div className="tk-vrow">
              <span>Event contract</span>
              <span className="kb-mono">
                {short(verified.contract)}
                <ExplorerLink
                  explorer={verified.explorer}
                  address={verified.contract}
                  label="Open the event contract"
                />
              </span>
            </div>
          </div>
        </Disclosure>
      </div>
    </GlassCard>
  );
});
