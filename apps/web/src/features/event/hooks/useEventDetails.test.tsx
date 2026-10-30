import type { PropsWithChildren } from "react";

import { localEventArgs } from "@kickback/contracts/local";
import { KLEROS, buildEventInfo, ipfsCidV0, serializeEventInfo } from "@kickback/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useEventDetails } from "./useEventDetails";
import type { KickbackEvent } from "../api/useEvent";
import { contractTint, dominantColour } from "../model/eventDetails";

const event = { contract: "0x1111111111111111111111111111111111111111" as const };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const cover = { path: `/ipfs/${ipfsCidV0(png)}`, bytes: png.length, mime: "image/png" as const };
const json = serializeEventInfo(
  buildEventInfo({ description: "Pinned details", cover, links: [{ label: "Host", url: "https://example.com" }] }),
);
const infoPath = `/ipfs/${ipfsCidV0(json)}`;
function fixture(path: string | null = infoPath): KickbackEvent {
  const local = localEventArgs({
    owner: event.contract,
    disputeResolver: KLEROS[1]!.disputeResolver,
    eventStart: 1000n,
    eventInfo: path ?? undefined,
    details: { eventTitle: "Dinner", eventLink: "https://luma.com/dinner" },
  });
  return {
    ...event,
    clock: null,
    stakerCount: 0,
    metaEvidenceTemplate: local.template,
    owner: event.contract,
    disputeResolver: KLEROS[1]!.disputeResolver,
    arbitrator: KLEROS[1]!.arbitrator,
    eventName: "Dinner",
    depositAmount: 10n,
    eventStart: 1000,
    claimDeadline: 100000,
    policyURI: local.policyURI,
    phase: 0,
  };
}
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (raw: string) => {
      if (raw.endsWith(infoPath)) return new Response(json);
      if (raw.endsWith(cover.path)) return new Response(png);
      if (raw.startsWith("/api/preview?"))
        return Response.json({ title: "RSVP", siteName: "Luma", image: "/api/preview/image?url=x" });
      throw new Error("Unexpected request");
    }),
  );
  vi.stubGlobal(
    "Image",
    class {
      onerror?: () => void;
      set src(_url: string) {
        this.onerror?.();
      }
    },
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:verified-cover");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("loads verified info and cover, fetches the registration preview, and revokes its blob", async () => {
  const { result, unmount } = renderHook(() => useEventDetails(fixture()), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.coverUrl).toBe("blob:verified-cover"));
  expect(result.current.description).toBe("Pinned details");
  expect(result.current.details.title).toBe("Dinner");
  await waitFor(() => expect(result.current.preview?.title).toBe("RSVP"));
  expect(fetch).toHaveBeenCalledWith("/api/preview?url=https%3A%2F%2Fluma.com%2Fdinner");
  expect(document.documentElement.style.getPropertyValue("--kb-route-tint")).toBe(contractTint(event.contract));
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:verified-cover");
  expect(document.documentElement.style.getPropertyValue("--kb-route-tint")).toBe("");
});

it("does not display a cover whose bytes do not match its CID", async () => {
  vi.mocked(fetch).mockImplementation(async (raw) =>
    String(raw).endsWith(infoPath) ? new Response(json) : new Response("wrong"),
  );
  const { result } = renderHook(() => useEventDetails(fixture()), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.description).toBe("Pinned details"));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining(cover.path), expect.anything()));
  expect(result.current.coverUrl).toBeUndefined();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("keeps only on-chain fields when the info is absent or fails verification", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("tampered"));
  const { result } = renderHook(() => useEventDetails(fixture()), { wrapper: wrapper() });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(result.current.details.title).toBe("Dinner");
  expect(result.current.description).toBe("");
  expect(result.current.coverUrl).toBeUndefined();
  const empty = renderHook(() => useEventDetails(fixture(null)), { wrapper: wrapper() });
  expect(empty.result.current.details.infoPath).toBeNull();
  expect(empty.result.current.links).toEqual([]);
});

it("chooses the most frequent opaque cover colour or a stable contract hue", () => {
  expect(dominantColour(new Uint8ClampedArray([240, 30, 20, 255, 241, 30, 20, 255, 0, 0, 200, 255, 0, 0, 0, 0]))).toBe(
    "rgb(241 30 20)",
  );
  expect(dominantColour(new Uint8ClampedArray([0, 0, 0, 0]))).toBeNull();
  expect(contractTint(event.contract.toUpperCase())).toBe(contractTint(event.contract));
});

it("falls back to exactly the parsed live Truth Pays fields without IPFS or preview requests", () => {
  const live = fixture(null);
  live.metaEvidenceTemplate = {
    slots: "0x",
    pieces: [
      JSON.stringify({
        description:
          'This case is about one guest of Truth Pays: Dinner, a Devcon Mumbai side event (networking dinner) on 2 November, at Mumbai, hosted by Friends. The deposit contract calls it "Truth Pays".',
      }),
    ],
  };
  const { result } = renderHook(() => useEventDetails(live), { wrapper: wrapper() });
  expect(result.current.details).toMatchObject({
    title: "Truth Pays: Dinner",
    where: "Mumbai",
    hosts: ["Friends"],
    link: null,
    infoPath: null,
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("tints the aurora with the verified cover's dominant colour", async () => {
  vi.stubGlobal(
    "Image",
    class {
      onload?: () => void;
      set src(_url: string) {
        this.onload?.();
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([220, 50, 40, 255]) }),
  } as unknown as CanvasRenderingContext2D);
  const { result } = renderHook(() => useEventDetails(fixture()), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.tint).toBe("rgb(220 50 40)"));
  expect(document.documentElement.style.getPropertyValue("--kb-route-tint")).toBe("rgb(220 50 40)");
});

it("uses the verified organiser template in the receipt with the guest URL and form details", async () => {
  const { useReceiptShare } = await import("./useReceiptShare");
  const json = serializeEventInfo(buildEventInfo({ share: "At {event} {venue} {date}: {luma} {guestLink}" }));
  const path = `/ipfs/${ipfsCidV0(json)}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(json)),
  );
  const event = { ...fixture(path), lumaUrl: "https://luma.com/dinner" };
  const { result } = renderHook(() => useReceiptShare(event, "42"), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.text).toMatch(/^At Dinner/));
  expect(result.current.text).toContain("https://luma.com/dinner");
  expect(result.current.guestLink).toBe(`${window.location.origin}/event/${event.contract}?from=42`);
  expect(result.current.text).toContain(result.current.guestLink);
});

it("uses the default share text when old events have no info document", async () => {
  const { useReceiptShare } = await import("./useReceiptShare");
  const { result } = renderHook(() => useReceiptShare(fixture(null)), { wrapper: wrapper() });
  expect(result.current.text).toContain("I just locked my spot at Dinner");
  expect(result.current.text).toContain("https://luma.com/dinner");
  expect(fetch).not.toHaveBeenCalled();
});

it("falls back to the known Luma page only when the case template has no registration link", async () => {
  const { withRegistrationLink } = await import("./useEventDetails");
  expect(withRegistrationLink({ link: null }, "https://luma.com/qewnqhas").link).toBe("https://luma.com/qewnqhas");
  expect(withRegistrationLink({ link: "https://luma.com/dinner" }, "https://luma.com/qewnqhas").link).toBe(
    "https://luma.com/dinner",
  );
  expect(withRegistrationLink({ link: null }, undefined).link).toBeNull();
});
