import { presenceEventAbi } from "@kickback/contracts";
import { challengeOf, type ChallengeInfo } from "@kickback/core";
import type { Address, PublicClient } from "viem";

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
  /** Challenges, oldest first. */
  challenges: (ChallengeInfo & { wallet: Address })[];
}

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
  const challenges = challengers.map((wallet, i) => ({ wallet, ...challengeOf(raw[i]!) }));
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
    challenges,
  };
}
