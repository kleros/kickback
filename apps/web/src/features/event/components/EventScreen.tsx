"use client";

import { useEffect, useRef } from "react";

import type { Address } from "viem";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";
import { fromBlockFor } from "@/config/event";
import { courtName } from "@/config/kleros";
import { HOW_IT_WORKS_ID } from "@/config/paths";

import { EventDetails } from "./EventDetails";
import { EventHead } from "./EventHead";
import { HowItWorks } from "./HowItWorks";
import { ReceiptExtras } from "./ReceiptExtras";
import { Refusal } from "./Refusal";
import { TicketCard } from "./TicketCard";
import { TicketSkeleton } from "./TicketSkeleton";
import { EventRefused, usePreviewShare, useEvent, type KickbackEvent } from "../api/useEvent";
import { useDepositState } from "../hooks/useDepositState";
import { useReceiptShare } from "../hooks/useReceiptShare";
import { ethText } from "../model/depositState";
import { shareExample } from "../model/share";

const COURT = courtName(DEFAULT_CHAIN_ID);

function LoadedEvent({ event, from }: { event: KickbackEvent; from?: string }) {
  const ticket = useRef<HTMLElement>(null);
  const share = useReceiptShare(event, from);
  const controller = useDepositState(event, fromBlockFor(event.contract, from));
  const amount = ethText(event.depositAmount);
  const example0 = shareExample(event.depositAmount, event.stakerCount);
  const preview = usePreviewShare(event.contract, example0.real ? example0.attend : undefined);
  const example =
    example0.real && preview.data !== undefined
      ? shareExample(event.depositAmount, event.stakerCount, preview.data)
      : example0;

  // the fragment is set before the page has height; land on it once the section exists
  useEffect(() => {
    if (window.location.hash === `#${HOW_IT_WORKS_ID}`) document.getElementById(HOW_IT_WORKS_ID)?.scrollIntoView();
  }, []);

  const backToCard = () => {
    ticket.current?.scrollIntoView({ block: "center" });
    ticket.current?.querySelector<HTMLElement>(".tk-btn .kb-btn")?.focus({ preventScroll: true });
  };

  return (
    <>
      <div className="kb-narrow">
        <EventHead name={event.eventName} eventStart={event.eventStart} clock={event.clock} />
        <TicketCard
          ref={ticket}
          entrance
          view={controller.view}
          amount={amount}
          actions={controller}
          lumaUrl={event.lumaUrl}
          verified={{
            contract: event.contract,
            disputeResolver: event.disputeResolver as Address,
            arbitrator: event.arbitrator as Address,
            explorer: DEFAULT_CHAIN.blockExplorers?.default.url,
            court: COURT,
          }}
        />
        <ReceiptExtras view={controller.view} name={event.eventName} amount={amount} {...share} />
      </div>
      <EventDetails key={event.contract} event={event} />
      <HowItWorks
        amount={amount}
        example={example}
        eventStart={event.eventStart}
        claimDeadline={event.claimDeadline}
        clock={event.clock}
        court={COURT}
        onDeposit={backToCard}
        depositOpen={controller.depositOpen}
      />
    </>
  );
}

export function EventScreen({ contract, from }: { contract: string; from?: string }) {
  const event = useEvent(contract);

  if (event.error instanceof EventRefused) return <Refusal reason={event.error.reason} address={contract} />;
  if (event.error)
    return (
      <div className="kb-narrow">
        <p className="text-kb-text-2">The network did not answer. Reload the page to try again.</p>
      </div>
    );
  if (!event.data) return <TicketSkeleton />;
  return <LoadedEvent key={event.data.contract} event={event.data} from={from} />;
}
