import { eventDetailsFromCase, fmtEth, readEvent, renderCase } from "@kickback/core";
import { zeroAddress } from "viem";

export const GENERIC_EVENT_CARD = {
  title: "Kickback",
  date: "Show up. Get your deposit back.",
  deposit: "Refundable event deposits",
};

export async function readEventCard(client: Parameters<typeof readEvent>[0], contract: string) {
  try {
    const event = await readEvent(client, contract);
    const details = eventDetailsFromCase(renderCase(event.metaEvidenceTemplate, zeroAddress, event.contract));
    return {
      title: details.title || event.eventName,
      date: details.when || new Date(event.eventStart * 1000).toISOString().slice(0, 10),
      deposit: `Refundable deposit ${fmtEth(event.depositAmount)}`,
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
