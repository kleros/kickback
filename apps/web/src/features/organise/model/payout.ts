import { TX_GAS_CAP, type EventInfo } from "@kickback/core";
import type { Address } from "viem";

import { gate, type Gate } from "./shared";

export interface ChallengeFact {
  wallet: Address;
  state: number;
  matchEndsAt: number;
  matched: boolean;
}

export function releasePlan(challenges: readonly ChallengeFact[], now: number, estimate: bigint | null) {
  const expired = challenges.filter((c) => c.state === 1 && now > c.matchEndsAt);
  const needsPreSettlement = expired.length > 0 && (estimate === null || (estimate * 13n) / 10n > TX_GAS_CAP);
  return { needsPreSettlement, wallets: needsPreSettlement ? expired.map((c) => c.wallet) : [], gas: estimate };
}

export function dustBound(attendees: bigint, matchedCases: bigint) {
  if (attendees < 0n || matchedCases < 0n) throw new Error("Counts cannot be negative.");
  return attendees + matchedCases * (attendees + 1n);
}

export function payoutGates(input: {
  event: Pick<EventInfo, "phase" | "claimDeadline">;
  now: number;
  isOwner: boolean;
  release: Gate;
  spare: bigint;
  attendees: bigint;
  matchedCases: bigint;
  confirmation?: string;
  guestStatus?: number;
  amount?: bigint;
  tokenBalance?: bigint;
}) {
  const { event, now, isOwner, spare, confirmation, guestStatus, amount, tokenBalance } = input;
  const owner = isOwner ? null : "Connect the organiser's wallet.";
  const dust = dustBound(input.attendees, input.matchedCases);
  return {
    release: gate(
      !input.release.enabled
        ? input.release.lockedReason
        : confirmation !== "PAY"
          ? "Type PAY to release payouts."
          : null,
    ),
    sweep: gate(
      owner ??
        (event.phase < 2
          ? "Collect leftovers after payouts or cancellation."
          : spare <= 0n
            ? "Nothing left over."
            : spare > dust && confirmation !== "SWEEP"
              ? "More than rounding dust; return guests' money first, then type SWEEP."
              : null),
    ),
    cancel: gate(
      owner ??
        (event.phase !== 0
          ? "Cancel only before the attendance list is posted."
          : now > event.claimDeadline
            ? "The cancellation deadline has passed."
            : confirmation !== "CANCEL"
              ? "Type CANCEL; only registered stakers are refunded."
              : null),
    ),
    removeGuest: gate(
      owner ??
        (event.phase !== 0
          ? "Remove a guest only before the list is posted."
          : guestStatus !== 1
            ? "Choose a registered guest."
            : null),
    ),
    refund: gate(
      owner ??
        (amount === undefined || amount <= 0n
          ? "Enter an amount to return."
          : amount > spare
            ? "Only spare ETH can be returned; guests' reserved money is protected."
            : null),
    ),
    returnToken: gate(
      owner ??
        (tokenBalance === undefined
          ? "Read the token balance first."
          : amount === undefined || amount <= 0n
            ? "Enter an amount to return."
            : amount > tokenBalance
              ? "The amount exceeds the token balance."
              : null),
    ),
    dustBound: dust,
  };
}

export function payoutFigures(input: {
  phase: number;
  deposit: bigint;
  registered: number;
  attendees: number;
  challenges: readonly ChallengeFact[];
  payoutShare: bigint;
  heldBack: bigint;
  now: number;
}) {
  if (input.phase === 0) return { pool: null, attendees: null, share: null, heldBack: null };
  const pool = input.deposit * BigInt(input.registered);
  if (input.phase >= 2) return { pool, attendees: input.attendees, share: input.payoutShare, heldBack: input.heldBack };
  const attendees = input.attendees + input.challenges.filter((c) => c.state === 1 && input.now > c.matchEndsAt).length;
  const disputed = input.challenges.filter((c) => c.state === 2).length;
  const shares = BigInt(attendees + disputed);
  const share = shares ? pool / shares : 0n;
  return { pool, attendees, share, heldBack: share * BigInt(disputed) };
}
