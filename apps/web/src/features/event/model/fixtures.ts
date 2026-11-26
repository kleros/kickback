import { parseEther, type Address, type Hash } from "viem";

import type { DepositInput, GuestState } from "./depositState";

/** The deposit card's states as the gallery shows them: pending in its three stages. */
export const GALLERY_STATES = [
  "rest",
  "nowallet",
  "connect",
  "wrongnet",
  "addchain",
  "ready",
  "approve",
  "insufficient",
  "signing",
  "pending1",
  "pending2",
  "pending3",
  "done",
  "failed",
  "closed",
  "full",
  "already",
  "earlier",
  "dropped",
  "replaced",
  "refunded",
  "on-list",
  "listing",
  "challenge",
  "challenged",
  "disputed",
  "withdraw",
  "claim",
  "paid-out",
  "not-attended",
  "withdrawn",
  "checking",
  "restoring",
  "full-visitor",
  "addchain-failed",
  "resolve",
] as const;

export type GalleryState = (typeof GALLERY_STATES)[number];

const WALLET: Address = "0x4a8F0b2E8d1a6C3f5B7e9D2c4A6b8E0f1D3c2c1E";
const TX: Hash = "0x8f3a6b2c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d691c2";
const NOW_MS = 1_793_800_000_000;
const SEC = 1000;

export const FIXTURE = { wallet: WALLET, tx: TX, nowMs: NOW_MS } as const;

/** A guest on Ethereum with 0.0412 ETH, before the event, nothing sent yet. */
export function baseInput(): DepositInput {
  return {
    amount: parseEther("0.01"),
    asset: { symbol: "ETH", decimals: 18 },
    eventStart: NOW_MS / 1000 + 4 * 86_400,
    eventEnd: NOW_MS / 1000 + 5 * 86_400,
    phase: 0,
    challengeDeposit: parseEther("0.03"),
    chainNow: NOW_MS / 1000,
    chain: { id: 1, name: "Ethereum" },
    wallet: { status: "connected", address: WALLET, chainId: 1, hasProvider: true, asked: false, needsChain: false },
    balance: parseEther("0.0412"),
    fee: parseEther("0.0003"),
    history: {},
    sent: null,
    send: { account: WALLET, status: "idle" },
    wallNow: NOW_MS,
    guests: 26,
    explorer: "https://etherscan.io",
    dayText: (unix) =>
      new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(unix * 1000),
    chainName: (id) => ({ 1: "Ethereum", 42161: "Arbitrum One" })[id],
  };
}

const disconnected = { status: "disconnected" as const, address: undefined, chainId: undefined };

/** The input that puts the card in `state`. */
export function galleryInput(state: GalleryState): DepositInput {
  const b = baseInput();
  const sending = { account: WALLET, status: "pending" as const, startedAt: NOW_MS - 60 * SEC };
  const pending = (waited: number): DepositInput => ({
    ...b,
    send: { account: WALLET, status: "pending", startedAt: NOW_MS - waited - 5 * SEC },
    sent: { data: "0xd0e30db0", value: b.amount.toString(), outcome: "pending", hash: TX, at: NOW_MS - waited },
  });
  const guest = (over: Partial<GuestState> = {}): GuestState => ({
    status: 1,
    attended: false,
    claimable: 0n,
    claimableEth: 0n,
    sharePaid: 0n,
    challenge: { state: 0, matchEndsAt: 0, arbitratorDisputeID: 0n, deposit: 0n, localDisputeID: 0n },
    ...over,
  });
  const listed = { ...b, phase: 1, challengeEndsAt: b.chainNow! + 86_400 };
  switch (state) {
    case "checking":
      return { ...b, chainNow: undefined };
    case "withdraw":
      return { ...b, claimDeadline: b.chainNow! - 1, guest: guest({ claimable: b.amount }) };
    case "claim":
      return { ...b, phase: 2, guest: guest({ attended: true, claimable: 12500000000000000n }) };
    case "paid-out":
      return {
        ...b,
        phase: 2,
        guest: guest({ attended: true, sharePaid: 12500000000000000n }),
        history: { paidTx: TX },
      };
    case "not-attended":
      return { ...b, phase: 2, guest: guest() };
    case "on-list":
      return { ...listed, guest: guest({ attended: true }) };
    case "listing":
      return { ...listed, challengeEndsAt: 0, guest: guest() };
    case "challenge":
      return { ...listed, guest: guest() };
    case "challenged":
      return {
        ...listed,
        guest: guest({
          challenge: {
            state: 1,
            matchEndsAt: b.chainNow! + 86_400,
            arbitratorDisputeID: 0n,
            deposit: parseEther("0.03"),
            localDisputeID: 0n,
          },
        }),
      };
    case "resolve":
      return {
        ...listed,
        guest: guest({
          challenge: {
            state: 1,
            matchEndsAt: b.chainNow! - 60,
            arbitratorDisputeID: 0n,
            deposit: parseEther("0.03"),
            localDisputeID: 0n,
          },
        }),
      };
    case "disputed":
      return {
        ...listed,
        caseUrl: (id) => `https://court.kleros.io/cases/${id}`,
        evidenceUrl: (id) => `https://resolve.kleros.io/cases/${id}`,
        guest: guest({
          challenge: {
            state: 2,
            matchEndsAt: b.chainNow! - 60,
            arbitratorDisputeID: 1712n,
            deposit: parseEther("0.03"),
            localDisputeID: 31n,
          },
        }),
      };
    case "withdrawn":
      return { ...b, guest: guest({ status: 3 }) };
    case "rest":
      return { ...b, wallet: { ...b.wallet, ...disconnected }, history: undefined };
    case "nowallet":
      return { ...b, wallet: { ...b.wallet, ...disconnected, hasProvider: false, asked: true }, history: undefined };
    case "connect":
      return { ...b, wallet: { ...b.wallet, ...disconnected, status: "connecting", asked: true }, history: undefined };
    case "wrongnet":
      return { ...b, wallet: { ...b.wallet, chainId: 42161 } };
    case "addchain":
      return { ...b, wallet: { ...b.wallet, chainId: 42161, needsChain: true } };
    case "ready":
      return b;
    case "approve":
      return {
        ...b,
        amount: 25_000_000n,
        asset: { symbol: "USDC", decimals: 6, token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
        tokenBalance: 140_000_000n,
        allowance: 0n,
      };
    case "insufficient":
      return { ...b, balance: parseEther("0.0062") };
    case "signing":
      return { ...b, send: sending };
    case "pending1":
      return pending(14 * SEC);
    case "pending2":
      return pending(134 * SEC);
    case "pending3":
      return pending(400 * SEC);
    case "done":
      return { ...b, send: { account: WALLET, status: "success", hash: TX } };
    case "failed":
      return { ...b, send: { account: WALLET, status: "error", errorKind: "reverted", hash: TX } };
    case "closed":
      return { ...b, wallet: { ...b.wallet, ...disconnected }, chainNow: b.eventEnd + 60, history: undefined };
    case "full":
      return { ...b, capacity: 40, stakerCount: 40 };
    case "full-visitor":
      return { ...b, wallet: { ...b.wallet, ...disconnected }, capacity: 40, stakerCount: 40, history: undefined };
    case "restoring":
      return { ...b, wallet: { ...b.wallet, ...disconnected, restoring: true }, history: undefined };
    case "addchain-failed":
      return { ...b, wallet: { ...b.wallet, chainId: 42161, needsChain: true, chainFailed: true } };
    case "already":
      return { ...b, guest: guest(), history: { txHash: TX, at: NOW_MS / 1000 - 2 * 86_400 } };
    case "earlier":
      return {
        ...b,
        sent: {
          data: "0xd0e30db0",
          value: b.amount.toString(),
          outcome: "pending",
          hash: TX,
          at: NOW_MS - 3 * 60 * SEC,
        },
      };
    case "dropped":
      return {
        ...b,
        sent: {
          data: "0xd0e30db0",
          value: b.amount.toString(),
          outcome: "dropped",
          hash: TX,
          at: NOW_MS - 40 * 60 * SEC,
        },
      };
    case "replaced":
      return { ...b, send: { account: WALLET, status: "error", errorKind: "replaced", hash: TX } };
    case "refunded":
      return { ...b, guest: guest({ status: 2 }), history: { txHash: TX, refundedAt: NOW_MS / 1000 - 86_400 } };
  }
}
