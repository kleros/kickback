import { amountText, isAddressStrict, readEvent } from "@kickback/core";

import { PROTOCOL } from "@/config/protocol";

export const GENERIC_EVENT_CARD = {
  title: "Kickback",
  date: "Show up. Get your deposit back.",
  deposit: "Refundable event deposits",
};

/** The link card for an event: only events this site's factory created get their own. */
export async function readEventCard(client: Parameters<typeof readEvent>[0], contract: string, protocol = PROTOCOL) {
  try {
    if (!isAddressStrict(contract) || !protocol) return GENERIC_EVENT_CARD;
    const event = await readEvent(client, contract, protocol);
    return {
      title: event.name,
      date: new Date(event.eventStart * 1000).toISOString().slice(0, 10),
      deposit: `Refundable deposit ${amountText(event.depositAmount, event)}`,
    };
  } catch {
    return GENERIC_EVENT_CARD;
  }
}

export function eventCardMetadata(card: typeof GENERIC_EVENT_CARD, contract: string) {
  const title = `${card.title} | Kickback`;
  const description = `${card.title}. ${card.date}. ${card.deposit}.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website" as const,
      images: [
        {
          url: `/event/${encodeURIComponent(contract)}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: card.title,
        },
      ],
    },
  };
}
