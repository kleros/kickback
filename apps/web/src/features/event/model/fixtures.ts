import { parseEther, type Address, type Hash } from "viem";

import type { DepositInput } from "./depositState";

/** The deposit card's states as the gallery shows them: pending in its three stages. */
export const GALLERY_STATES = [
  "rest",
  "nowallet",
  "connect",
  "wrongnet",
  "addchain",
  "ready",
  "insufficient",
  "signing",
  "pending1",
  "pending2",
  "pending3",
  "done",
  "failed",
  "closed",
  "already",
  "earlier",
  "dropped",
  "replaced",
  "refunded",
  "short",
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
    eventStart: NOW_MS / 1000 + 5 * 86_400,
    phase: 0,
    chainNow: NOW_MS / 1000,
    chain: { id: 1, name: "Ethereum" },
    wallet: { status: "connected", address: WALLET, chainId: 1, hasProvider: true, asked: false, needsChain: false },
    balance: parseEther("0.0412"),
    fee: parseEther("0.0003"),
    history: { deposited: 0n },
    sent: null,
    send: { status: "idle" },
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
  const sending = { status: "pending" as const, startedAt: NOW_MS - 60 * SEC };
  const pending = (waited: number): DepositInput => ({
    ...b,
    send: { status: "pending", startedAt: NOW_MS - waited - 5 * SEC },
    sent: { outcome: "pending", hash: TX, at: NOW_MS - waited },
  });
  switch (state) {
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
      return { ...b, send: { status: "success", hash: TX } };
    case "failed":
      return { ...b, send: { status: "error", errorKind: "reverted", hash: TX } };
    case "closed":
      return { ...b, wallet: { ...b.wallet, ...disconnected }, chainNow: b.eventStart + 60, history: undefined };
    case "already":
      return { ...b, history: { deposited: b.amount, txHash: TX, at: NOW_MS / 1000 - 2 * 86_400 } };
    case "earlier":
      return { ...b, sent: { outcome: "pending", hash: TX, at: NOW_MS - 3 * 60 * SEC } };
    case "dropped":
      return { ...b, sent: { outcome: "dropped", hash: TX, at: NOW_MS - 40 * 60 * SEC } };
    case "replaced":
      return { ...b, send: { status: "error", errorKind: "replaced", hash: TX } };
    case "refunded":
      return { ...b, history: { deposited: b.amount, txHash: TX, refundedAt: NOW_MS / 1000 - 86_400 } };
    case "short":
      return { ...b, history: { deposited: parseEther("0.005"), txHash: TX } };
  }
}
