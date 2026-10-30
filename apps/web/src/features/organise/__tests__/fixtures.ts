import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  KLEROS,
  contractConfig,
  type BuildPayoutResult,
  type CheckGuestsResult,
  type EventInfo,
  type GuestCheck,
  type OverviewRow,
} from "@kickback/core";
import { type Address, type PublicClient } from "viem";
import { vi } from "vitest";

export const owner: Address = "0x1111111111111111111111111111111111111111";
export const address: Address = "0x2222222222222222222222222222222222222222";
export const guest: Address = "0x3333333333333333333333333333333333333333";
export const policyURI = "/ipfs/QmPzb9q9TyHS2jPmoCd1U9eDfZ9Nijh5NSFhhvJGVU7knE";
export const scope = { address, chainId: 1 };
export const event: EventInfo = {
  contract: address,
  eventName: "Dinner",
  depositAmount: 10n,
  eventStart: 1000,
  claimDeadline: 1000000,
  owner,
  disputeResolver: KLEROS[1]!.disputeResolver,
  arbitrator: KLEROS[1]!.arbitrator,
  policyURI,
  metaEvidenceTemplate: { pieces: ["Dinner"], slots: "0x" },
  phase: 0,
};
export const cfg = contractConfig(event, { chainId: 1 }, 1);
export const form = {
  title: "Dinner",
  shortName: "Dinner",
  start: "2027-01-01T18:00",
  end: "2027-01-01T22:00",
  timezoneOffset: "+05:30",
  zoneName: "IST",
  venue: "Delhi",
  hosts: "Friends",
  registrationLink: "https://luma.com/dinner",
  deposit: "0.01",
  settleDays: 14,
};
export const plan: BuildPayoutResult = {
  contract: address,
  stakers: [guest],
  attendees: [{ wallet: guest, name: "Guest", email: "guest@example.com", emails: new Set(["guest@example.com"]) }],
  noShows: [],
  deposit: 10n,
  pool: 10n,
  share: 10n,
  dust: 0n,
  plan: { contract: address, chainId: 1, stakers: 1, attendees: [guest], share: "10", shareEth: "0.00000000000000001" },
  payoutRows: [],
  summaryMarkdown: "One attendee",
  door: null,
  missing: [],
  unknown: [],
  unknownNote: "",
};
export const row: OverviewRow = {
  tx: `0x${"a".repeat(64)}`,
  from: guest,
  amount: 10n,
  block: 9,
  sentAt: "",
  explorer: "",
  status: "unregistered",
  held: 10n,
  code: "VERIFIED",
  note: "",
  heldForSpot: true,
  canRegister: true,
  canRefund: true,
};
export const checked: GuestCheck = {
  name: "Guest",
  email: "guest@example.com",
  ticket: "deposit",
  approval: "approved",
  decision: "approved",
  wallet: guest,
  tx: row.tx,
  ok: true,
  code: "VERIFIED",
  note: "",
  onchain: "unregistered",
};
export function guestCheck(patch: Partial<CheckGuestsResult> = {}): CheckGuestsResult {
  return {
    verified: [checked],
    issues: [],
    toReview: [],
    returns: [],
    unmatched: [],
    claims: [checked],
    newStakers: [checked],
    refunds: [],
    lists: { newStakers: stamp(), refunds: stamp() },
    held: [checked],
    issueCounts: {},
    incoming: [],
    totalIncoming: 10n,
    openUnmatched: [],
    unbacked: [],
    unpaired: [],
    warnings: [],
    columns: {},
    snapshotBlock: 10,
    results: [checked],
    byDeposit: new Map(),
    statusOf: new Map([[guest.toLowerCase(), 0]]),
    listOpen: true,
    ...patch,
  };
}
export function stamp() {
  return {
    contract: address,
    chainId: 1,
    deposit: "10",
    block: 10,
    generatedAt: "",
    items: [{ wallet: guest, name: "Guest", email: "", onchain: "unregistered", status: 0 }],
  };
}

export function mockClient() {
  const values: Record<string, unknown> = {
    eventName: event.eventName,
    depositAmount: event.depositAmount,
    eventStart: BigInt(event.eventStart),
    claimDeadline: BigInt(event.claimDeadline),
    owner,
    disputeResolver: event.disputeResolver,
    arbitrator: event.arbitrator,
    policyURI,
    metaEvidenceTemplate: [event.metaEvidenceTemplate.pieces, "0x"],
    phase: 0,
    stakerCount: 1n,
    attendeeCount: 1n,
    challengeEndsAt: 2000n,
    pendingChallenges: 0n,
    spare: 100n,
    challengers: [],
    payoutShare: 10n,
    heldBack: 0n,
    stakers: [guest],
    status: 1,
    previewShare: 10n,
    balanceOf: 100n,
  };
  const methods = {
    chain: { id: 1 },
    getBlock: vi.fn().mockResolvedValue({ number: 10n, timestamp: 1500n, transactions: [] }),
    getBlockNumber: vi.fn().mockResolvedValue(10n),
    getCode: vi
      .fn()
      .mockResolvedValue(
        readFileSync(
          resolve(
            import.meta.dirname,
            "../../../../../../packages/contracts/deployments-live/truth-pays-mainnet/runtime-code.hex",
          ),
          "utf8",
        ).trim(),
      ),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (!(functionName in values)) throw new Error(`Unexpected read: ${functionName}`);
      return values[functionName];
    }),
    getLogs: vi.fn().mockResolvedValue([]),
    getTransaction: vi.fn(),
    getTransactionReceipt: vi.fn(),
    call: vi.fn().mockResolvedValue({ data: "0x" }),
    estimateGas: vi.fn().mockResolvedValue(100000n),
  };
  return { values, methods, client: methods as unknown as PublicClient };
}
