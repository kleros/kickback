"use client";

import { EventHead } from "./EventHead";
import { ReceiptExtras } from "./ReceiptExtras";
import { TicketCard, type TicketActions } from "./TicketCard";
import { depositState } from "../model/depositState";
import { GALLERY_STATES, galleryInput, type GalleryState } from "../model/fixtures";

const noop = () => {};
const ACTIONS: TicketActions = {
  connect: noop,
  switchChain: noop,
  addChain: noop,
  deposit: noop,
  withdraw: noop,
  claim: noop,
  challenge: noop,
  approve: noop,
  resolve: noop,
  recheck: noop,
};
const VERIFIED = {
  contract: "0x6c2d4D1bC2B0aCe3F2A9f0f1b7f4f4a1d9e3B2a1",
  factory: "0xdbf41b66714E6fE1402Dc43Afa602189877681ae",
  disputeResolver: "0x4B89e798B10478A839Ea0Abcf86C4B94A3C782A4",
  arbitrator: "0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069",
  explorer: "https://etherscan.io",
  court: "Kleros Court",
} as const;
const EVENT_START = 1_793_802_600;
const IST = { offset: 330, zone: "IST" };

function Card({ state }: { state: GalleryState }) {
  const input = galleryInput(state);
  const view = depositState(input);
  return (
    <>
      <TicketCard
        view={view}
        amount="0.01"
        unit={input.asset.symbol}
        actions={ACTIONS}
        verified={VERIFIED}
        lumaUrl="https://luma.com/example"
      />
      <ReceiptExtras
        view={view}
        text="I just put down a refundable deposit for Builders' Dinner. Join me: https://luma.com/example"
        luma="https://luma.com/example"
        guestLink={`/event/${VERIFIED.contract}`}
      />
    </>
  );
}

/** Every deposit state from fixtures, for layout checks and screenshots. Not a production route. */
export function DepositStatesGallery({ state }: { state?: string }) {
  const one = GALLERY_STATES.find((s) => s === state);
  if (one)
    return (
      <div className="kb-narrow" data-testid="gallery-one">
        <EventHead name="Builders' Dinner" eventStart={EVENT_START} clock={IST} />
        <Card state={one} />
      </div>
    );

  return (
    <div
      data-testid="gallery"
      style={{ display: "grid", gap: 32, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))" }}
    >
      {GALLERY_STATES.map((s) => (
        <figure key={s} data-gallery-state={s}>
          <Card state={s} />
          <figcaption className="text-kb-text-3 mt-2 text-center text-xs">{s}</figcaption>
        </figure>
      ))}
    </div>
  );
}
