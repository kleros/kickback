// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { kickbackAbi } from "@kickback/contracts";
import { decodeFunctionData, encodeFunctionResult, type Hex } from "viem";
import { afterEach, expect, it, vi } from "vitest";

import { DEFAULT_CHAIN } from "@/config/chains";

import { createEventCardClient, EVENT_CARD_MAX_RESPONSE_BYTES, EVENT_CARD_TIMEOUT_MS } from "../eventCardClient";
import { eventCardMetadata, GENERIC_EVENT_CARD, readEventCard } from "../openGraph";

const publicClient = createEventCardClient(DEFAULT_CHAIN);
const contract = "0x1111111111111111111111111111111111111111";
const code = readFileSync(
  resolve("../../packages/contracts/deployments-live/truth-pays-mainnet/runtime-code.hex"),
  "utf8",
).trim();
const values = {
  eventName: "Dinner 🎉",
  depositAmount: 10000000000000000n,
  eventStart: 1793802600n,
  claimDeadline: 1794802600n,
  owner: contract,
  disputeResolver: contract,
  arbitrator: contract,
  policyURI: "/ipfs/policy",
  phase: 0,
  metaEvidenceTemplate: [["Old event without details"], "0x"],
};
const rpc = vi.fn(async (_url: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  const name =
    body.method === "eth_call"
      ? decodeFunctionData({ abi: kickbackAbi, data: body.params[0].data }).functionName
      : undefined;
  const result = name
    ? encodeFunctionResult({
        abi: kickbackAbi,
        functionName: name,
        result: values[name as keyof typeof values],
      } as never)
    : code;
  return Response.json({ jsonrpc: "2.0", id: body.id, result });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it("reads event details and metadata through the supplied client", async () => {
  vi.stubGlobal("fetch", rpc);
  const card = await readEventCard(publicClient, contract);
  expect(rpc.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).method)).toEqual([
    "eth_getCode",
    ...Array(10).fill("eth_call"),
  ]);
  expect(card).toEqual({ title: "Dinner 🎉", date: "2026-11-04", deposit: "Refundable deposit 0.01 ETH" });
  expect(eventCardMetadata(card, contract).openGraph.images[0]?.url).toBe(`/event/${contract}/opengraph-image`);
});

it("rejects unknown bytecode before executing any getters", async () => {
  const readContract = vi.fn();
  const getCode = vi.fn(async (): Promise<Hex> => "0x1234");
  expect(await readEventCard({ getCode, readContract }, contract)).toEqual(GENERIC_EVENT_CARD);
  expect(getCode).toHaveBeenCalledOnce();
  expect(readContract).not.toHaveBeenCalled();
});

it.each(["code", "getter"])("falls back when a %s response exceeds the size limit", async (stage) => {
  const cancel = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (stage === "getter" && body.method === "eth_getCode") return rpc(url, init);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(EVENT_CARD_MAX_RESPONSE_BYTES + 1));
          },
          cancel,
        }),
      );
    }),
  );
  expect(await readEventCard(publicClient, contract)).toEqual(GENERIC_EVENT_CARD);
  expect(cancel).toHaveBeenCalled();
});

it.each(["code", "getter"])("times out and aborts a stalled %s body without retrying", async (stage) => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  const fetchMock = vi.fn(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (stage === "getter" && body.method === "eth_getCode") return rpc(url, init);
    signals.push(init.signal);
    return new Response(
      new ReadableStream({
        start(controller) {
          init.signal.addEventListener("abort", () => controller.error(new Error("aborted")));
        },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const reading = readEventCard(publicClient, contract);
  await vi.advanceTimersByTimeAsync(EVENT_CARD_TIMEOUT_MS);
  expect(await reading).toEqual(GENERIC_EVENT_CARD);
  expect(signals.length).toBeGreaterThan(0);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(stage === "code" ? 1 : 11);
});

it("skips RPC reads for malformed addresses", async () => {
  vi.stubGlobal("fetch", rpc);
  expect(await readEventCard(publicClient, "invalid")).toEqual(GENERIC_EVENT_CARD);
  expect(rpc).not.toHaveBeenCalled();
});
