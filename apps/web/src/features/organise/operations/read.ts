import { presenceEventAbi } from "@kickback/contracts";
import { challengeOf, type ChallengeInfo } from "@kickback/core";
import { parseAbi, zeroAddress, type Address, type PublicClient } from "viem";

import { readSolved } from "@/lib/kleros/ruling";
import { loadEvent, type KickbackEvent } from "@/lib/presence";

export interface GuestRow {
  wallet: Address;
  /** 0 None, 1 Staker (booked), 2 Rejected (turned away), 3 Refunded (withdrew after a cancel or a missed list). */
  status: number;
  attended: boolean;
  /** With a Kleros case: whether it is ruled, and the ruling. */
  challenge?: ChallengeInfo & { isRuled?: boolean; ruling?: number };
}

export interface OrganiserState {
  event: KickbackEvent;
  /** The latest block's time. */
  now: number;
  guests: GuestRow[];
  /** Booked wallets (status 1). */
  booked: Address[];
  attendees: Address[];
  /**
   * Attendees whose share is not paid out yet (only after payouts are released), with what each is still owed: a
   * partly paid attendee claimed before a lost Kleros case's held share was split.
   */
  unpaid: { wallet: Address; owed: bigint; partlyPaid: boolean }[];
  /** Lower-case attendee wallet → its sharePaid (only after payouts are released). */
  sharePaid: Map<string, bigint>;
  /** Attendees whose wallet refused a pushed payment that is still waiting for them (owed > 0). */
  refused: Address[];
  /**
   * Cancelled or missed-deadline events: refunded guests whose wallet refused the pushed refund, which is still
   * waiting for them (owed > 0).
   */
  refundRefused: Address[];
  /**
   * Challenges, oldest first; a case with Kleros carries whether it is ruled, and the ruling, and while it is not
   * final, the jurors' current ruling and its appeal window.
   */
  challenges: (ChallengeInfo & { wallet: Address; isRuled?: boolean; ruling?: number; appeal?: AppealInfo })[];
}

/** The contract's appealStatus(staker). */
export interface AppealInfo {
  /** 0 refused to rule, 1 attended, 2 did not attend. */
  ruling: number;
  start: number;
  /** 0 while no appeal window is open. */
  end: number;
  /** The losing side (both sides after a 0) must fund an appeal by then. */
  loserEnd: number;
  costAttended: bigint;
  costAbsent: bigint;
  /** The ruling is final on the arbitrator but not recorded yet (executeRuling not called). */
  final?: boolean;
}

const RESOLVER_ABI = parseAbi(["function disputes(uint256) view returns (bytes, bool, uint256, uint256)"]);

/** Everything the organiser tabs show, read in one round from the latest block. */
export async function readOrganiser(client: PublicClient, contract: string): Promise<OrganiserState> {
  const event = await loadEvent(client, contract);
  const c = { address: event.contract, abi: presenceEventAbi } as const;
  const [block, stakers, attendees, challengers] = await Promise.all([
    client.getBlock(),
    client.readContract({ ...c, functionName: "stakers" }),
    client.readContract({ ...c, functionName: "attendees" }),
    client.readContract({ ...c, functionName: "challengers" }),
  ]);
  const [statuses, attended, raw] = await Promise.all([
    Promise.all(stakers.map((s) => client.readContract({ ...c, functionName: "status", args: [s] }))),
    Promise.all(stakers.map((s) => client.readContract({ ...c, functionName: "attended", args: [s] }))),
    Promise.all(challengers.map((s) => client.readContract({ ...c, functionName: "challenges", args: [s] }))),
  ]);
  const listed = challengers.map((wallet, i) => ({ wallet, ...challengeOf(raw[i]!) }));
  // the contract's own test for a share still owed: sharePaid below payoutShare (claimable() would keep
  // picking a wallet that refuses the push)
  const [paid, owed, rulings] = await Promise.all([
    event.phase === 2
      ? Promise.all(attendees.map((a) => client.readContract({ ...c, functionName: "sharePaid", args: [a] })))
      : Promise.resolve([] as bigint[]),
    event.phase === 2
      ? Promise.all(attendees.map((a) => client.readContract({ ...c, functionName: "owed", args: [a] })))
      : Promise.resolve([] as bigint[]),
    Promise.all(
      listed.map((ch) =>
        ch.state === 2 || (ch.state === 3 && ch.matcher !== zeroAddress)
          ? client
              .readContract({
                address: event.disputeResolver,
                abi: RESOLVER_ABI,
                functionName: "disputes",
                args: [ch.localDisputeID],
              })
              .then(([, isRuled, ruling]) => ({ isRuled, ruling: Number(ruling) }))
          : Promise.resolve(undefined),
      ),
    ),
  ]);
  // a case with Kleros that is not final: read its appeal window (a read that fails keeps the plain wording)
  const appeals = await Promise.all(
    listed.map((ch, i) =>
      ch.state === 2 && rulings[i]?.isRuled !== true
        ? client
            .readContract({ ...c, functionName: "appealStatus", args: [ch.wallet] })
            .then(async ([ruling, start, end, loserEnd, costAttended, costAbsent]) => ({
              ruling: Number(ruling),
              start: Number(start),
              end: Number(end),
              loserEnd: Number(loserEnd),
              costAttended,
              costAbsent,
              // no appeal window: still deciding, or final and waiting to be recorded
              final:
                Number(end) === 0
                  ? await readSolved(client, event.contract, ch.arbitratorDisputeID, event.arbitrator)
                  : false,
            }))
            .catch(() => undefined)
        : Promise.resolve(undefined),
    ),
  );
  const challenges = listed.map((ch, i) => ({ ...ch, ...rulings[i], appeal: appeals[i] }));
  // a refund pushed to a wallet that refused it stays owed to that (already Refunded) wallet
  const refundPhase = event.phase === 3 || (event.phase === 0 && Number(block.timestamp) > event.claimDeadline);
  const refunded = refundPhase ? stakers.filter((_, i) => Number(statuses[i]) === 3) : [];
  const refundOwed = await Promise.all(
    refunded.map((a) => client.readContract({ ...c, functionName: "owed", args: [a] })),
  );
  const refundRefused = refunded.filter((_, i) => refundOwed[i]! > 0n);
  const unpaid =
    event.phase === 2
      ? attendees.flatMap((wallet, i) =>
          paid[i]! < event.payoutShare
            ? [{ wallet, owed: event.payoutShare - paid[i]!, partlyPaid: paid[i]! > 0n }]
            : [],
        )
      : [];
  const sharePaid = new Map(event.phase === 2 ? attendees.map((a, i) => [a.toLowerCase(), paid[i]!] as const) : []);
  const refused = event.phase === 2 ? attendees.filter((_, i) => owed[i]! > 0n) : [];
  const byWallet = new Map(challenges.map((ch) => [ch.wallet.toLowerCase(), ch]));
  const guests = stakers.map((wallet, i) => ({
    wallet,
    status: Number(statuses[i]),
    attended: attended[i]!,
    challenge: byWallet.get(wallet.toLowerCase()),
  }));
  return {
    event,
    now: Number(block.timestamp),
    guests,
    booked: guests.filter((g) => g.status === 1).map((g) => g.wallet),
    attendees: [...attendees],
    unpaid,
    sharePaid,
    refused,
    refundRefused,
    challenges,
  };
}
