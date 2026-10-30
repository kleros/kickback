import { readFileSync } from "node:fs";

import {
  deployLocalEvent,
  localEventArgs,
  caseTemplate as localSplit,
  templateValues as localValues,
} from "@kickback/contracts/local";
import { kickbackAbi } from "@kickback/contracts";
import { decodeAbiParameters, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  buildEventInfo,
  validateEventInfo,
  parseEventInfo,
  serializeEventInfo,
  fetchEventInfo,
  fetchEventCover,
  eventCoverObjectUrl,
  ipfsCidV0,
  eventDetailsFromCase,
  mapEmbedUrl,
  caseTemplate,
  templateValues,
  renderCase,
  MAX_COVER_BYTES,
  readLimitedBytes,
} from "../src";
import { read } from "./docs";

const path = `/ipfs/${ipfsCidV0("info")}`;
const cover = { path, mime: "image/png" as const, bytes: 8 };
const base = { version: 1, description: "Hello", links: [] };
const owner = "0x1111111111111111111111111111111111111111";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const fetcher = (bytes: Uint8Array | string) =>
  vi.fn<typeof fetch>().mockImplementation(async () => new Response(bytes));

describe("event info documents", () => {
  it("normalizes at build time, validates strictly and sorts keys recursively", () => {
    const doc = buildEventInfo({
      description: " Cafe\u0301\nDinner ",
      cover,
      links: [{ url: "https://luma.com/a", label: " RSVP " }],
    });
    expect(doc.description).toBe("Café\nDinner");
    const json = serializeEventInfo(doc);
    expect(json).toBe(
      `{"cover":{"bytes":8,"mime":"image/png","path":"${path}"},"description":"Café\\nDinner","links":[{"label":"RSVP","url":"https://luma.com/a"}],"version":1}`,
    );
    expect(parseEventInfo(json)).toEqual(doc);
    expect(ipfsCidV0(json)).toBe(
      ipfsCidV0(serializeEventInfo({ links: doc.links, version: 1, cover, description: doc.description })),
    );
    expect(buildEventInfo({}).description).toBe("");
    expect(validateEventInfo({ ...base, description: "a".repeat(1200) })).toBeTruthy();
  });
  it.each([
    "a".repeat(1201),
    "e\u0301",
    "\u0000",
    "\t",
    "\r",
    "\u202e",
    "\u2066",
    "\u200b",
    "\u00ad",
    "\u034f",
    "\ufe0f",
    "\ud800",
    "{{x}}",
    "}}",
    "<img src=x>",
  ])("rejects unsafe description %j", (description) => {
    expect(() => validateEventInfo({ ...base, description })).toThrow();
  });
  it.each([
    null,
    [],
    {},
    { ...base, version: 2 },
    { ...base, extra: true },
    { ...base, links: Array(4).fill({ label: "x", url: "https://luma.com" }) },
    { ...base, links: [{ label: "", url: "https://luma.com" }] },
    { ...base, links: [{ label: "x".repeat(41), url: "https://luma.com" }] },
  ])("rejects malformed documents", (value) => {
    expect(() => validateEventInfo(value)).toThrow();
  });
  it.each([
    "http://luma.com",
    "javascript:alert(1)",
    "https://me:secret@luma.com",
    "https://lu\u200bma.com",
    "https://例.com/a",
    "https://luma.com\\evil",
    "https://luma.com/ x",
  ])("rejects link %s", (url) => {
    expect(() => buildEventInfo({ links: [{ label: "a", url }] })).toThrow();
  });
  it.each([
    { bytes: 0 },
    { bytes: 1.1 },
    { bytes: MAX_COVER_BYTES + 1 },
    { mime: "image/svg+xml" },
    { path: `${path}/file` },
    { path: "https://cdn.kleros.link" + path },
  ])("rejects invalid covers", (patch) => {
    expect(() => validateEventInfo({ ...base, cover: { ...cover, ...patch } })).toThrow();
  });
  it("limits JSON bytes before parsing", () => {
    expect(() => parseEventInfo(" ".repeat(65537))).toThrow("64 KB");
    expect(() => parseEventInfo("no")).toThrow();
  });
});

describe("verified IPFS reads", () => {
  it("fetches only the fixed gateway and verifies raw bytes before validation", async () => {
    const json = serializeEventInfo(buildEventInfo({ description: "Dinner" }));
    const fetch = fetcher(json);
    const uri = `/ipfs/${ipfsCidV0(json)}`;
    expect(await fetchEventInfo(uri, fetch)).toEqual(parseEventInfo(json));
    expect(fetch).toHaveBeenCalledWith(`https://cdn.kleros.link${uri}`, expect.objectContaining({ redirect: "error" }));
    await expect(fetchEventInfo(uri, fetcher(json + " "))).rejects.toThrow("CID");
    await expect(fetchEventInfo(`${uri}/file`, fetch)).rejects.toThrow("CIDv0");
    await expect(fetchEventInfo(`/ipfs/${ipfsCidV0("{}")}`, fetcher("{}"))).rejects.toThrow();
    await expect(fetchEventInfo(uri, fetcher("x".repeat(65537)))).rejects.toThrow("limit");
    await expect(
      fetchEventInfo(
        uri,
        vi.fn(async () => new Response(null, { status: 404 })),
      ),
    ).rejects.toThrow("fetch");
  });
  it("enforces streaming and declared limits and cancels oversized streams", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(10));
      },
      cancel,
    });
    await expect(readLimitedBytes(new Response(stream), 9)).rejects.toThrow("limit");
    expect(cancel).toHaveBeenCalled();
    await expect(readLimitedBytes(new Response("a", { headers: { "content-length": "100" } }), 9)).rejects.toThrow(
      "limit",
    );
  });
  it("verifies image CID, size and signature before creating an object URL", async () => {
    const c = { ...cover, path: `/ipfs/${ipfsCidV0(png)}` };
    const blob = await fetchEventCover(c, fetcher(png));
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(8);
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:verified");
    expect(await eventCoverObjectUrl(c, fetcher(png))).toBe("blob:verified");
    create.mockRestore();
    await expect(fetchEventCover({ ...c, bytes: 9 }, fetcher(png))).rejects.toThrow("size");
    await expect(fetchEventCover({ ...c, mime: "image/jpeg" }, fetcher(png))).rejects.toThrow("type");
    await expect(fetchEventCover(c, fetcher(new Uint8Array(8)))).rejects.toThrow("CID");
  });
  it("matches a two-leaf UnixFS vector at the chunk boundary", () => {
    // 262144 zero bytes and one zero byte: leaf DAG sizes 262158 and 9, root DAG-PB size 100.
    expect(ipfsCidV0(new Uint8Array(262145))).toBe("QmbVuw4C4vcmVKqxoWtgDVobvcHrSn51qsmQmyxjk4sB2Q");
  });
  it("verifies multi-block covers up to 2 MiB", async () => {
    const large = new Uint8Array(MAX_COVER_BYTES);
    large.set(png);
    const cid = ipfsCidV0(large);
    expect(cid).toMatch(/^Qm.{44}$/);
    expect(cid).not.toBe(ipfsCidV0(large.subarray(0, 262144)));
    expect(
      (await fetchEventCover({ path: `/ipfs/${cid}`, bytes: large.length, mime: "image/png" }, fetcher(large))).size,
    ).toBe(MAX_COVER_BYTES);
    expect(() => ipfsCidV0(new Uint8Array(MAX_COVER_BYTES + 1))).toThrow();
  });
});

describe("case event details", () => {
  const cfg = {
    eventTitle: 'Dinner "A"',
    eventName: "Dinner",
    eventWhen: "Friday, 19:00 UTC",
    eventWhere: "Berlin",
    hosts: "Ann, Bob and Carol",
    eventLink: "https://luma.com/dinner",
    eventInfo: path,
    depositUnits: 1n,
    kleros: { policyURI: path },
  };
  it("matches both template splits and reads generic descriptions with and without info", () => {
    const generic = read("docs/metaevidence.generic.template.json");
    const values = templateValues(cfg, owner);
    expect(localValues(cfg, owner)).toEqual(values);
    expect(localSplit(generic, values)).toEqual(caseTemplate(generic, values));
    const parsed = eventDetailsFromCase(caseTemplate(generic, values).sample);
    expect(parsed).toEqual({
      title: cfg.eventTitle,
      when: cfg.eventWhen,
      where: cfg.eventWhere,
      hosts: ["Ann", "Bob", "Carol"],
      link: cfg.eventLink,
      name: cfg.eventName,
      infoPath: path,
    });
    expect(
      eventDetailsFromCase(caseTemplate(generic.replace("event page details: {{eventInfo}}; ", ""), values).sample),
    ).toEqual({ ...parsed, infoPath: null });
    expect(eventDetailsFromCase(caseTemplate(generic, { ...values, eventInfo: undefined }).sample).infoPath).toBeNull();
    expect(() => caseTemplate(generic, { ...values, eventInfo: "https://evil.com" })).toThrow("info path");
    expect(() => localSplit(generic, { ...values, eventInfo: "https://evil.com" })).toThrow("info path");
  });
  it("reads the actual live constructor template, without inventing a registration URL", () => {
    const constructor = kickbackAbi.find((entry) => entry.type === "constructor")!;
    const args = decodeAbiParameters(
      constructor.inputs,
      `0x${read("deployments-live/truth-pays-mainnet/constructor-arguments.txt").trim().replace(/^0x/, "")}` as Hex,
    );
    const text = renderCase({ pieces: args[5].metaEvidenceTemplate, slots: args[5].metaEvidenceSlots }, owner, owner);
    const details = eventDetailsFromCase(text);
    expect(details).toEqual({
      title: "Truth Pays: Queryable Data, Prediction Markets & Onchain Justice",
      when: "Wednesday 4 November 2026, 18:00-22:00 IST",
      where: "the venue announced to registered guests on Luma (planned: Hitchki, Bandra Kurla Complex (BKC), Mumbai)",
      hosts: ["Kleros", "Arkiv (Golem Network)", "Web3 Mumbai"],
      name: "Truth Pays: Devcon Mumbai 2026",
      link: null,
      infoPath: null,
    });
  });
  it("reads deployLocalEvent output using stubbed clients", async () => {
    const walletClient = { account: { address: owner }, deployContract: vi.fn(async () => "0x01") };
    const publicClient = {
      getBlock: vi.fn(async () => ({ timestamp: 100n })),
      waitForTransactionReceipt: vi.fn(async () => ({ status: "success", contractAddress: owner, blockNumber: 1n })),
      readContract: vi.fn(async () => owner),
    };
    // These clients implement only the methods deployLocalEvent calls.
    const ev = await deployLocalEvent({
      walletClient,
      publicClient,
      disputeResolver: owner,
      eventInfo: path,
    } as unknown as Parameters<typeof deployLocalEvent>[0]);
    expect(eventDetailsFromCase(renderCase(ev.template, owner, owner))).toMatchObject({
      title: ev.details.eventTitle,
      infoPath: path,
    });
    const legacy = localEventArgs({ owner, disputeResolver: owner, eventStart: 100n });
    expect(eventDetailsFromCase(renderCase(legacy.template, owner, owner)).infoPath).toBeNull();
    expect(walletClient.deployContract).toHaveBeenCalledOnce();
  });
  it.each([null, "bad", "{", "{}", '{"description":3}'])("returns nulls for unknown cases", (text) => {
    expect(eventDetailsFromCase(text)).toEqual({
      title: null,
      when: null,
      where: null,
      hosts: [],
      link: null,
      name: null,
      infoPath: null,
    });
  });
  it("constructs an encoded map URL and rejects invalid venues", () => {
    expect(mapEmbedUrl(" Café & Hall #2 ")).toBe(
      "https://www.google.com/maps?q=Caf%C3%A9%20%26%20Hall%20%232&output=embed",
    );
    for (const where of [" ", "a".repeat(201), "Hall\u202e"]) expect(() => mapEmbedUrl(where)).toThrow();
    expect(readFileSync(new URL("../src/eventDetails.ts", import.meta.url), "utf8")).toContain(
      'sandbox="allow-scripts allow-same-origin allow-popups"',
    );
  });
});
