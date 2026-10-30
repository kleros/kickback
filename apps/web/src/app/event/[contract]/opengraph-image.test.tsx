// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

import { GENERIC_EVENT_CARD } from "@/features/event/operations/openGraph";
import { serverEventCard } from "@/features/event/operations/serverEventCard";

import OpenGraphImage from "./opengraph-image";

vi.mock("@/features/event/operations/serverEventCard", () => ({ serverEventCard: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([{ title: "Dinner", date: "4 Nov 2026", deposit: "Refundable deposit 0.01 ETH" }, GENERIC_EVENT_CARD])(
  "renders a 1200 by 630 PNG for $title without network assets",
  async (card) => {
    vi.mocked(serverEventCard).mockResolvedValue(card);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Network assets are not allowed in this test.");
      }),
    );
    const response = await OpenGraphImage({ params: { contract: "0x123" } });
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
    expect(serverEventCard).toHaveBeenCalledWith("0x123");
    expect(fetch).not.toHaveBeenCalled();
  },
);
