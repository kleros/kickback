"use client";

import { useEffect, useRef } from "react";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";
import { HOW_IT_WORKS_ID } from "@/config/paths";
import { courtName } from "@/config/protocol";

import { EventDetails } from "./EventDetails";
import { EventHead } from "./EventHead";
import { HowItWorks } from "./HowItWorks";
import { ReceiptExtras } from "./ReceiptExtras";
import { Refusal } from "./Refusal";
import { TicketCard } from "./TicketCard";
import { TicketSkeleton } from "./TicketSkeleton";
import { EventRefused, useEvent, type KickbackEvent } from "../api/useEvent";
import { useDepositState } from "../hooks/useDepositState";
import { useReceiptShare } from "../hooks/useReceiptShare";
import { unitsText } from "../model/depositState";
import { shareExample } from "../model/share";

const COURT = courtName(DEFAULT_CHAIN_ID);

function LoadedEvent({ event, from }: { event: KickbackEvent; from?: string }) {
  const ticket = useRef<HTMLElement>(null);
  const share = useReceiptShare(event, from);
  const controller = useDepositState(event);
  const amount = unitsText(event.depositAmount, event.decimals);
  const example = shareExample(event.depositAmount, event.stakerCount);

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
        <EventHead name={event.eventName} eventStart={event.eventStart} eventEnd={event.eventEnd} clock={event.clock} />
        <TicketCard
          ref={ticket}
          entrance
          view={controller.view}
          amount={amount}
          unit={event.symbol}
          actions={controller}
          lumaUrl={event.lumaUrl}
          verified={{
            contract: event.contract,
            factory: event.factory,
            disputeResolver: event.disputeResolver,
            arbitrator: event.arbitrator,
            explorer: DEFAULT_CHAIN.blockExplorers?.default.url,
            court: COURT,
          }}
        />
        <ReceiptExtras view={controller.view} {...share} />
      </div>
      <EventDetails key={event.contract} event={event} />
      <HowItWorks
        amount={amount}
        unit={event.symbol}
        decimals={event.decimals}
        example={example}
        eventEnd={event.eventEnd}
        claimDeadline={event.claimDeadline}
        challengePeriod={event.challengePeriod}
        challengeEndsAt={event.challengeEndsAt}
        clock={event.clock}
        court={COURT}
        challengeFee={event.challengeDeposit}
        onDeposit={backToCard}
        depositOpen={controller.depositOpen && ["rest", "nowallet", "connect", "ready"].includes(controller.view.key)}
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
