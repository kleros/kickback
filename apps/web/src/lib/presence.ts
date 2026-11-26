import { KickbackError, LUMA_URL, readEvent, type EventInfo } from "@kickback/core";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { PROTOCOL } from "@/config/protocol";

/** A fixed clock to show times on: minutes east of UTC, and its name ("IST"). */
export interface EventClock {
  offset: number;
  zone: string;
}

export type RefusalReason = "not-address" | "no-contract" | "not-kickback" | "look-alike";

export interface KickbackEvent extends EventInfo {
  /** The event's name, as the contract stores it. */
  eventName: string;
  /** Dates are shown on the visitor's own clock: the contract stores no time zone. */
  clock: EventClock | null;
  /** The registration page, when the event's link is a Luma page. */
  lumaUrl?: string;
}

export class EventRefused extends Error {
  constructor(
    readonly reason: RefusalReason,
    readonly address: string,
  ) {
    super(reason);
  }
}

const refusalOf = (error: unknown): RefusalReason | undefined => {
  if (!(error instanceof KickbackError)) return undefined;
  if (error.code === "NO_KICKBACK_CONTRACT") return "no-contract";
  if (error.code === "UNKNOWN_CODE") return "look-alike";
  if (error.code === "NOT_KICKBACK") return "not-kickback";
  return undefined;
};

export const eventKey = (contract: string) => ["event", DEFAULT_CHAIN_ID, contract.toLowerCase()] as const;

/** Reads and checks an event: it must be a clone this site's factory created (isEvent), or EventRefused is thrown. */
export async function loadEvent(
  client: Parameters<typeof readEvent>[0],
  contract: string,
  protocol = PROTOCOL,
): Promise<KickbackEvent> {
  let info: EventInfo;
  try {
    if (!protocol) throw new KickbackError("No factory on this network yet.", "NO_KICKBACK_CONTRACT");
    info = await readEvent(client, contract, protocol);
  } catch (error) {
    const reason = refusalOf(error);
    if (reason) throw new EventRefused(/^0x[0-9a-fA-F]{40}$/.test(contract) ? reason : "not-address", contract);
    throw error;
  }
  return {
    ...info,
    eventName: info.name,
    clock: null,
    lumaUrl: LUMA_URL.test(info.url) ? info.url : undefined,
  };
}
