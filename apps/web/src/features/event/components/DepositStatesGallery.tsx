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
  recheck: noop,
};
const VERIFIED = {
  contract: "0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D",
  disputeResolver: "0x4B89e798B10478A839Ea0Abcf86C4B94A3C782A4",
  arbitrator: "0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069",
  explorer: "https://etherscan.io",
  court: "Kleros Court",
} as const;
const EVENT_START = 1_793_802_600;
const IST = { offset: 330, zone: "IST" };

function Card({ state }: { state: GalleryState }) {
  const view = depositState(galleryInput(state));
  return (
    <>
      <TicketCard
        view={view}
        amount="0.01"
        actions={ACTIONS}
        verified={VERIFIED}
        lumaUrl="https://luma.com/truth-pays"
      />
      <ReceiptExtras
        view={view}
        name="Truth Pays"
        amount="0.01"
        text="Join Truth Pays https://luma.com/truth-pays"
        luma="https://luma.com/truth-pays"
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
        <EventHead name="Truth Pays: Devcon Mumbai 2026" eventStart={EVENT_START} clock={IST} />
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
