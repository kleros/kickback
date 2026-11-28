import { presenceEventAbi } from "@kickback/contracts";
import { challengeOf, isAddressStrict, KickbackError, LUMA_URL, readEvent, type EventInfo } from "@kickback/core";
import { parseAbi } from "viem";

import { DEFAULT_CHAIN_ID } from "@/config/chains";
import { PROTOCOL } from "@/config/protocol";

/** A fixed clock to show times on: minutes east of UTC, and its name ("IST"). */
export interface EventClock {
  offset: number;
  zone: string;
}

export type RefusalReason = "not-address" | "bad-checksum" | "no-contract" | "not-kickback" | "look-alike";

export interface KickbackEvent extends EventInfo {
  /** The event's name, as the contract stores it. */
  eventName: string;
  /** Dates are shown on the visitor's own clock: the contract stores no time zone. */
  clock: EventClock | null;
  /** The registration page, when the event's link is a Luma page. */
  lumaUrl?: string;
  /** Challenges ever made (only once the list is closed); undefined when they could not be read. */
  challengeCount?: number;
  /** Challenges the organiser sent to Kleros (cases open or settled). */
  casesSent?: number;
  /** Open Kleros cases the jurors have ruled on (ruling 0, 1 or 2) but nobody has settled yet; undefined when unknown. */
  ruledCases?: number;
  /** The answer deadline (matchEndsAt) of each challenge still waiting for the organiser; undefined when unknown. */
  waitingAnswerEnds?: number[];
  /**
   * An open event with no deposit now: whether any guest held one at the end (kept, or refunded after a missed
   * deadline). False means nobody did, so nothing was ever due; undefined when unknown or not asked.
   */
  heldAtEnd?: boolean;
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

const RESOLVER_ABI = parseAbi(["function disputes(uint256) view returns (bytes, bool, uint256, uint256)"]);

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
    // "not-kickback" only once real code was found: a broken checksum is a bad address, not a contract
    if (reason)
      throw new EventRefused(
        isAddressStrict(contract) ? reason : /^0x[0-9a-fA-F]{40}$/.test(contract) ? "bad-checksum" : "not-address",
        contract,
      );
    throw error;
  }
  // challenges exist only once the list is closed; a failed read keeps the plain wording
  let challengeCount: number | undefined;
  let casesSent: number | undefined;
  let ruledCases: number | undefined;
  let waitingAnswerEnds: number[] | undefined;
  if (info.challengeEndsAt > 0)
    try {
      const c = { address: info.contract, abi: presenceEventAbi } as const;
      const challengers = await client.readContract({ ...c, functionName: "challengers" });
      const raw = await Promise.all(
        challengers.map((s) => client.readContract({ ...c, functionName: "challenges", args: [s] })),
      );
      challengeCount = challengers.length;
      // a matched challenge has a matcher: with Kleros (2), or settled by Kleros (3)
      const all = raw.map(challengeOf);
      casesSent = all.filter((ch) => ch.state === 2 || (ch.state === 3 && !/^0x0{40}$/i.test(ch.matcher))).length;
      // past its answer time a waiting challenge can no longer be answered: it is added at the release
      waitingAnswerEnds = all.filter((ch) => ch.state === 1).map((ch) => ch.matchEndsAt);
      // a case Kleros has ruled on still counts as open until someone settles it
      try {
        const open = all.filter((ch) => ch.state === 2);
        const rulings = await Promise.all(
          open.map((ch) =>
            client.readContract({
              address: info.disputeResolver,
              abi: RESOLVER_ABI,
              functionName: "disputes",
              args: [ch.localDisputeID],
            }),
          ),
        );
        ruledCases = rulings.filter(([, isRuled, ruling]) => isRuled && Number(ruling) <= 2).length;
      } catch {
        // unknown: the plain wording stays
      }
    } catch {
      // unknown
    }
  // an open event with no deposit now: nobody deposited (or all were turned away), or every refund was taken back
  let heldAtEnd: boolean | undefined;
  if (info.phase === 0 && info.stakerCount === 0)
    try {
      const c = { address: info.contract, abi: presenceEventAbi } as const;
      const stakers = await client.readContract({ ...c, functionName: "stakers" });
      const statuses = await Promise.all(
        stakers.map((s) => client.readContract({ ...c, functionName: "status", args: [s] })),
      );
      // Staker (1) or Refunded (3): a deposit was held at the end; Rejected (2) was refunded before the start
      heldAtEnd = statuses.some((st) => Number(st) === 1 || Number(st) === 3);
    } catch {
      // unknown: the phase falls back to the deadline
    }
  return {
    ...info,
    heldAtEnd,
    challengeCount,
    casesSent,
    ruledCases,
    waitingAnswerEnds,
    eventName: info.name,
    clock: null,
    lumaUrl: LUMA_URL.test(info.url) ? info.url : undefined,
  };
}
