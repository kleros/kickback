import { presenceEventAbi } from "@kickback/contracts";
import { challengeOf, type ChallengeInfo } from "@kickback/core";
import { parseAbi, zeroAddress, type Address, type PublicClient } from "viem";

import { loadEvent, type KickbackEvent } from "@/lib/presence";

export interface GuestRow {
  wallet: Address;
  /** 0 None, 1 Staker (booked), 2 Rejected (turned away), 3 Refunded (withdrew after a cancel or a missed list). */
  status: number;
  attended: boolean;
  challenge?: ChallengeInfo;
}

export interface OrganiserState {
  event: KickbackEvent;
  /** The latest block's time. */
  now: number;
  guests: GuestRow[];
  /** Booked wallets (status 1). */
  booked: Address[];
  attendees: Address[];
  /** Attendees whose share is not paid out yet (only after payouts are released). */
  unpaid: Address[];
  /** Challenges, oldest first; a case with Kleros carries whether it is ruled, and the ruling. */
  challenges: (ChallengeInfo & { wallet: Address; isRuled?: boolean; ruling?: number })[];
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
  const [paid, rulings] = await Promise.all([
    event.phase === 2
      ? Promise.all(attendees.map((a) => client.readContract({ ...c, functionName: "sharePaid", args: [a] })))
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
  const challenges = listed.map((ch, i) => ({ ...ch, ...rulings[i] }));
  const unpaid = event.phase === 2 ? attendees.filter((_, i) => paid[i]! < event.payoutShare) : [];
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
    challenges,
  };
}
