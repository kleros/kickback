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

import { paths } from "@/config/paths";

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
          <Link className="kb-link" href={line.link.href} target="_blank" rel="noopener noreferrer">
            {line.link.label}
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

  const press = {
    connect: actions.connect,
    switch: actions.switchChain,
    "add-chain": actions.addChain,
    deposit: actions.deposit,
    withdraw: actions.withdraw,
    claim: actions.claim,
    challenge: actions.challenge,
    approve: actions.approve,
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
              <span className="v kb-mono" title={view.receipt.tx} data-testid="receipt-tx">
                {short(view.receipt.tx)}
                {view.receipt.when ? ` · ${view.receipt.when}` : ""}
              </span>
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
        {view.lines.map((line, i) => (
          <Line key={i} line={line} onRecheck={actions.recheck} />
        ))}
      </div>
      <div className="tk-btn">
        {view.action === "copy" && view.receipt ? (
          <CopyPrimaryButton value={view.receipt.txLink}>{view.button}</CopyPrimaryButton>
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
        {view.foot && <span>{view.foot}</span>}
        {done && lumaUrl && (
          <>
            {view.foot && <span aria-hidden>·</span>}
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
              Created by this site&apos;s factory, with disputes settled in Kleros Court. This verifies the code, not
              the organiser: anyone can create an event, so make sure you came here from the organiser&apos;s own event
              page.
            </p>
            <div className="tk-vrow">
              <span>Code</span>
              <span className="kb-mono">
                Proof of Presence factory {short(verified.factory)}
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
                  label="Open the resolver"
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
                <ExplorerLink explorer={verified.explorer} address={verified.contract} label="Open the contract" />
              </span>
            </div>
            <div className="tk-vrow">
              <span>List and challenges</span>
              <Link
                className="kb-link"
                href={paths.organiseEvent.getHref(verified.contract, undefined, "payout")}
                data-testid="public-challenges"
              >
                Open
              </Link>
            </div>
          </div>
        </Disclosure>
      </div>
    </GlassCard>
  );
});
