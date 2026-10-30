// @vitest-environment node
import { buildEventInfo, eventDetailsFromCase, ipfsCidV0, renderCase, serializeEventInfo } from "@kickback/core";
import * as v from "valibot";
import { afterEach, describe, expect, it, vi } from "vitest";

import { form, owner, policyURI } from "./fixtures";
import { createConfig, createDeployment, createEventSchema, jurorPreview, parseCreateForm } from "../model/create";
import { eventInfoTransport, pinEventInfo, prepareEventDeployment } from "../operations/eventInfo";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const cover = new File([png], "cover.png", { type: "image/png" });
afterEach(() => vi.restoreAllMocks());

describe("event info create flow", () => {
  it("pins cover before canonical JSON and renders its path in the preview and deployment", async () => {
    const pin = vi.fn(async (bytes: Uint8Array) => `/ipfs/${ipfsCidV0(bytes)}`);
    const input = {
      ...form,
      description: " Cafe\u0301 ",
      cover,
      links: [{ label: "RSVP", url: "https://luma.com/event" }],
    };
    const info = await pinEventInfo(input, { pin });
    expect(info).not.toBeNull();
    expect(pin).toHaveBeenNthCalledWith(1, png, "image/png", "cover");
    expect(pin).toHaveBeenNthCalledWith(2, new TextEncoder().encode(info!.json), "application/json", "event-info.json");
    expect(info!.document.cover).toEqual({ path: `/ipfs/${ipfsCidV0(png)}`, bytes: 8, mime: "image/png" });
    expect(info!.document.description).toBe("Café");
    expect(info!.json).toBe(serializeEventInfo(info!.document));
    const preview = jurorPreview(input, { chainId: 1 }, policyURI, owner, info!.path);
    expect(eventDetailsFromCase(preview).infoPath).toBe(info!.path);
    const deployment = createDeployment(input, { chainId: 1 }, owner, policyURI, 0, info!.path);
    expect(deployment.config.eventInfo).toBe(info!.path);
    expect(
      eventDetailsFromCase(renderCase({ pieces: deployment.args[5][2], slots: deployment.args[5][3] }, owner, owner))
        .infoPath,
    ).toBe(info!.path);
  });
  it("prepares deployment by pinning and passing the verified path, and refuses unpinned details", async () => {
    const input = { ...form, description: "Dinner details" };
    const pin = vi.fn(async (bytes: Uint8Array) => `/ipfs/${ipfsCidV0(bytes)}`);
    const result = await prepareEventDeployment(input, { chainId: 1 }, owner, policyURI, 0, { pin });
    expect(result.config.eventInfo).toBe(result.info?.path);
    expect(pin).toHaveBeenCalledOnce();
    expect(() => createDeployment(input, { chainId: 1 }, owner, policyURI, 0)).toThrow("Pin");
    pin.mockClear();
    await expect(prepareEventDeployment(input, { chainId: 1 }, owner, policyURI, Infinity, { pin })).rejects.toThrow(
      "future",
    );
    expect(pin).not.toHaveBeenCalled();
  });
  it("uses none for empty forms without pinning", async () => {
    const pin = vi.fn();
    expect(await pinEventInfo(form, { pin })).toBeNull();
    expect(pin).not.toHaveBeenCalled();
    expect(createConfig(form, { chainId: 1 }).eventInfo).toBe("none");
    expect(jurorPreview(form, { chainId: 1 }, policyURI)).toContain("event page details: none");
    expect(() => createConfig(form, { chainId: 1 }, owner, "https://evil.com")).toThrow();
  });
  it("pins text-only or links-only documents", async () => {
    for (const fields of [{ description: "Dinner" }, { links: [{ label: "Other", url: "https://example.com" }] }]) {
      const pin = vi.fn(async (bytes: Uint8Array) => `/ipfs/${ipfsCidV0(bytes)}`);
      const result = await pinEventInfo({ ...form, ...fields }, { pin });
      expect(pin).toHaveBeenCalledOnce();
      expect(result?.document.cover).toBeUndefined();
    }
  });
  it.each([
    { description: "x".repeat(1201) },
    { description: "Hello\u202e" },
    { description: "{{wallet}}" },
    { links: Array(4).fill({ label: "RSVP", url: "https://luma.com" }) },
    { links: [{ label: "x".repeat(41), url: "https://luma.com" }] },
    { links: [{ label: "link", url: "http://luma.com" }] },
    { cover: new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }) },
    { cover: new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }) },
  ])("rejects invalid info fields before upload", async (patch) => {
    const pin = vi.fn();
    expect(v.safeParse(createEventSchema, { ...form, ...patch }).success).toBe(false);
    expect(() => parseCreateForm({ ...form, ...patch })).toThrow();
    await expect(pinEventInfo({ ...form, ...patch }, { pin })).rejects.toThrow();
    expect(pin).not.toHaveBeenCalled();
  });
  it("rejects files with spoofed MIME and stops if the cover pin fails", async () => {
    const pin = vi.fn(async () => {
      throw new Error("pin failed");
    });
    await expect(
      pinEventInfo({ ...form, cover: new File(["<script/>"], "x.png", { type: "image/png" }) }, { pin }),
    ).rejects.toThrow("image type");
    expect(pin).not.toHaveBeenCalled();
    await expect(pinEventInfo({ ...form, cover }, { pin })).rejects.toThrow("pin failed");
    expect(pin).toHaveBeenCalledOnce();
  });
});

describe("event info pin transport", () => {
  const bytes = new TextEncoder().encode(serializeEventInfo(buildEventInfo({ description: "Dinner" })));
  const path = `/ipfs/${ipfsCidV0(bytes)}`;
  it("uploads operation=file and refetches from the fixed gateway to verify CID", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ cid: path.slice(6) }))
      .mockResolvedValueOnce(new Response(bytes));
    expect(await eventInfoTransport(fetcher).pin(bytes, "application/json", "event-info.json")).toBe(path);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://kleros-api.netlify.app/.netlify/functions/upload-to-ipfs?operation=file&pinToGraph=false",
    );
    expect(options?.method).toBe("POST");
    const file = (options?.body as FormData).get("data") as File;
    expect(file.type).toBe("application/json");
    expect(file.name).toBe("event-info.json");
    expect(fetcher.mock.calls[1]![0]).toBe(`https://cdn.kleros.link${path}`);
  });
  it("rejects a mismatched upload CID, changed gateway bytes and upload errors", async () => {
    for (const responses of [
      [Response.json({ cid: ipfsCidV0("wrong") })],
      [Response.json({ path }), new Response("tampered")],
      [new Response(null, { status: 500 })],
    ]) {
      const fetcher = vi.fn<typeof fetch>();
      for (const r of responses) fetcher.mockResolvedValueOnce(r);
      await expect(eventInfoTransport(fetcher).pin(bytes, "application/json", "event-info.json")).rejects.toThrow();
    }
  });
});
