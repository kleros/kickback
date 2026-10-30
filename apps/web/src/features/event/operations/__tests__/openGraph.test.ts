import { readEvent } from "@kickback/core";
import type { PublicClient } from "viem";
import { afterEach, expect, it, vi } from "vitest";

import { eventCardMetadata, GENERIC_EVENT_CARD, readEventCard } from "../openGraph";

vi.mock("@kickback/core", async (original) => ({
  ...(await original<typeof import("@kickback/core")>()),
  readEvent: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

it("reads event title, date and deposit server-side through the supplied client", async () => {
  const event = {
    contract: "0x1111111111111111111111111111111111111111",
    eventName: "Dinner 🎉",
    depositAmount: 10000000000000000n,
    eventStart: 1793802600,
    claimDeadline: 1794802600,
    owner: "0x1111111111111111111111111111111111111111",
    disputeResolver: "0x2222222222222222222222222222222222222222",
    arbitrator: "0x3333333333333333333333333333333333333333",
    policyURI: "/ipfs/policy",
    phase: 0,
    metaEvidenceTemplate: { pieces: ["Old event without details"], slots: "0x" },
  } as const;
  vi.mocked(readEvent).mockResolvedValue({
    ...event,
    metaEvidenceTemplate: { pieces: [...event.metaEvidenceTemplate.pieces], slots: "0x" },
  });
  const client = {} as PublicClient;
  const card = await readEventCard(client, event.contract);
  expect(readEvent).toHaveBeenCalledWith(client, event.contract);
  expect(card).toEqual({ title: "Dinner 🎉", date: "2026-11-04", deposit: "Refundable deposit 0.01 ETH" });
  expect(eventCardMetadata(card, event.contract)).toMatchObject({
    title: "Dinner 🎉 | Kickback",
    description: "Dinner 🎉. 2026-11-04. Refundable deposit 0.01 ETH.",
    openGraph: { images: [{ url: `/event/${event.contract}/opengraph-image`, width: 1200, height: 630 }] },
  });
});
it("uses the generic card if the contract or RPC read fails", async () => {
  vi.mocked(readEvent).mockRejectedValue(new Error("offline"));
  expect(await readEventCard({} as PublicClient, "invalid")).toEqual(GENERIC_EVENT_CARD);
});
