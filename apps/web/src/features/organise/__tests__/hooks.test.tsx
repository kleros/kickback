import type { PropsWithChildren } from "react";

import { kickbackBytecode } from "@kickback/contracts";
import { ipfsCidV0 } from "@kickback/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { zeroAddress, type TransactionReceipt } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SendArgs } from "@/lib/web3/send";

import { address, cfg, form, guest, mockClient, owner, plan, policyURI, scope, stamp } from "./fixtures";
import {
  useAddAttendees,
  useCancel,
  usePostAttendance,
  useRefund,
  useRegisterStakers,
  useRejectAndRefund,
  useReleasePayouts,
  useResolveChallenge,
  useReturnToken,
  useSweep,
} from "../hooks/useActions";
import { useAttendancePlan } from "../hooks/useAttendancePlan";
import { useCreateEvent, useDeploy } from "../hooks/useCreateEvent";
import { useEventOverview } from "../hooks/useEventOverview";
import { useGuests } from "../hooks/useGuests";
import { usePayoutActions } from "../hooks/usePayoutActions";
import { readDeployments, saveDeployment } from "../model/create";
import { GENERIC_POLICY_TEXT } from "../model/policy";
import { organiserKey } from "../model/shared";

const mocks = vi.hoisted(() => ({
  client: undefined as unknown,
  account: "" as string | undefined,
  send: vi.fn(),
  block: 10n,
}));
vi.mock("wagmi", () => ({ usePublicClient: () => mocks.client, useAccount: () => ({ address: mocks.account }) }));
vi.mock("@/config/chains", () => ({ DEFAULT_CHAIN_ID: 1 }));
vi.mock("@/lib/web3/chain-time", () => ({ useChainTime: () => ({ data: { now: 1500, blockNumber: mocks.block } }) }));
vi.mock("@/lib/web3/send", () => ({ useSend: () => ({ mutateAsync: mocks.send }) }));

function wrapper() {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queries}>{children}</QueryClientProvider>
  );
  return { queries, Wrapper };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let fake: ReturnType<typeof mockClient>;
beforeEach(() => {
  fake = mockClient();
  mocks.client = fake.client;
  mocks.account = owner;
  mocks.block = 10n;
  mocks.send.mockReset();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

const receipt = { status: "success", transactionHash: `0x${"a".repeat(64)}`, blockNumber: 11n } as TransactionReceipt;
const cases = [
  {
    name: "registerStakers",
    useHook: () => useRegisterStakers(scope),
    input: () => ({ list: stamp() }),
    setup: () => {
      fake.values.status = 0;
    },
  },
  {
    name: "rejectAndRefund",
    useHook: () => useRejectAndRefund(scope),
    input: () => ({ list: stamp() }),
    setup: () => {
      fake.values.status = 0;
    },
  },
  {
    name: "postAttendance",
    useHook: () => usePostAttendance(scope),
    input: () => ({ plan, confirmation: "POST" }),
    setup: () => {},
  },
  {
    name: "addAttendees",
    useHook: () => useAddAttendees(scope),
    input: () => ({ wallets: [guest] }),
    setup: () => {
      fake.values.phase = 1;
    },
  },
  {
    name: "releasePayouts",
    useHook: () => useReleasePayouts(scope),
    input: () => ({ confirmation: "PAY", expected: { pool: 10n, attendees: 1, share: 10n, heldBack: 0n } }),
    setup: () => {
      fake.values.phase = 1;
      fake.values.challengeEndsAt = 1499n;
    },
  },
  {
    name: "resolveChallenge",
    useHook: () => useResolveChallenge(scope),
    input: () => ({ wallet: guest, confirmation: "SETTLE" }),
    setup: () => {
      Object.assign(fake.values, {
        phase: 1,
        challengeEndsAt: 1499n,
        challengers: [guest],
        challenges: [1, zeroAddress, 1499n],
      });
      fake.methods.estimateGas.mockResolvedValue(16777216n);
    },
  },
  {
    name: "sweep",
    useHook: () => useSweep(scope),
    input: () => ({ confirmation: "SWEEP", expectedSpare: 100n }),
    setup: () => {
      fake.values.phase = 2;
    },
  },
  {
    name: "cancel",
    useHook: () => useCancel(scope),
    input: () => ({ confirmation: "CANCEL", expectedRegistered: 1 }),
    setup: () => {},
  },
  { name: "refund", useHook: () => useRefund(scope), input: () => ({ to: guest, amount: 1n }), setup: () => {} },
  {
    name: "returnToken",
    useHook: () => useReturnToken(scope),
    input: () => ({ token: guest, to: owner, amount: 1n }),
    setup: () => {},
  },
];

describe.each(cases)("$name write hook", ({ useHook, input, setup }) => {
  it("moves idle -> pending -> success, re-reads via useSend and invalidates only this event", async () => {
    setup();
    const pending = deferred<TransactionReceipt>();
    mocks.send.mockImplementation(async ({ prepare }: SendArgs) => {
      await prepare();
      return pending.promise;
    });
    const { queries, Wrapper } = wrapper();
    const invalidate = vi.spyOn(queries, "invalidateQueries");
    const { result } = renderHook<ReturnType<typeof useHook>, unknown>(() => useHook(), { wrapper: Wrapper });
    expect(result.current.status).toBe("idle");
    // The parameterized cases pair each hook with its own input shape.
    act(() => result.current.mutate(input() as never));
    await waitFor(() => expect(result.current.isPending).toBe(true));
    await waitFor(() => expect(fake.methods.readContract).toHaveBeenCalled());
    await act(async () => pending.resolve(receipt));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: organiserKey(scope) });
  });
  it("moves pending -> error, keeps inputs retryable and never invalidates on failure", async () => {
    const pending = deferred<TransactionReceipt>();
    mocks.send.mockReturnValue(pending.promise);
    const { queries, Wrapper } = wrapper();
    const invalidate = vi.spyOn(queries, "invalidateQueries");
    const { result } = renderHook<ReturnType<typeof useHook>, unknown>(() => useHook(), { wrapper: Wrapper });
    act(() => result.current.mutate(input() as never));
    await waitFor(() => expect(result.current.isPending).toBe(true));
    await act(async () => pending.reject(new Error("Wallet declined")));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Wallet declined");
    expect(invalidate).not.toHaveBeenCalled();
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });
});

it("refuses a stale snapshot before the mock wallet can send", async () => {
  fake.values.status = 0;
  fake.methods.getBlockNumber.mockResolvedValue(11n);
  fake.methods.getLogs.mockResolvedValue([{}]);
  const signed = vi.fn();
  mocks.send.mockImplementation(async ({ prepare }: SendArgs) => {
    await prepare();
    signed();
    return receipt;
  });
  const { Wrapper } = wrapper();
  const { result } = renderHook(() => useRegisterStakers(scope), { wrapper: Wrapper });
  act(() => result.current.mutate({ list: stamp() }));
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(signed).not.toHaveBeenCalled();
  expect(result.current.error?.message).toContain("since the check");
});

it("loads overview, follows block time, surfaces RPC failure, and recovers", async () => {
  fake.methods.getBlock.mockResolvedValue({
    number: 10n,
    timestamp: 999n,
    transactions: [{ hash: "0xabc", to: null }],
  });
  fake.methods.getTransactionReceipt.mockResolvedValue({ contractAddress: address });
  const { Wrapper } = wrapper();
  const { result, rerender } = renderHook(() => useEventOverview({ ...scope, deployBlock: 1 }), { wrapper: Wrapper });
  expect(result.current.isPending).toBe(true);
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.phase).toBe("Waiting for the event");
  fake.methods.getBlock.mockResolvedValue({
    number: 11n,
    timestamp: 1000n,
    transactions: [{ hash: "0xabc", to: null }],
  });
  mocks.block = 11n;
  rerender();
  await waitFor(() => expect(result.current.data?.phase).toBe("Attendance due"));
  fake.methods.getBlock.mockRejectedValueOnce(new Error("RPC unavailable"));
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
});

it("loads guests, checks CSV errors, resets uploads and isolates a second event", async () => {
  const { Wrapper } = wrapper();
  const { result, rerender } = renderHook(({ config }) => useGuests(config), {
    initialProps: { config: cfg },
    wrapper: Wrapper,
  });
  expect(result.current.isPending).toBe(true);
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.snapshotBlock).toBe(10);
  expect(result.current.selectedList("register").items).toEqual([]);
  act(() => {
    result.current.setTick("test", "register");
    result.current.loadCsv("broken csv");
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.csvLoaded).toBe(true);
  act(() => result.current.loadCsv(null));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  rerender({ config: { ...cfg, receiver: guest, contract: guest } });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.csvLoaded).toBe(false);
});

it("keeps attendance idle until files exist, builds from the real core, and exposes build errors", async () => {
  const { Wrapper } = wrapper();
  const input = { checkinCsv: null, doorCsv: `wallet\n${guest}` };
  const { result, rerender } = renderHook(({ enabled }) => useAttendancePlan(cfg, enabled ? input : null), {
    initialProps: { enabled: false },
    wrapper: Wrapper,
  });
  expect(result.current.fetchStatus).toBe("idle");
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.attendees).toBe(1);
  fake.methods.readContract.mockRejectedValueOnce(new Error("No network"));
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
});

it("payout query transitions through locked, ready, failed dry run and RPC error", async () => {
  const { Wrapper } = wrapper();
  const { result } = renderHook(() => usePayoutActions(scope, { confirmation: "PAY", token: guest, amount: 1n }), {
    wrapper: Wrapper,
  });
  expect(result.current.isPending).toBe(true);
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.release.enabled).toBe(false);
  Object.assign(fake.values, { phase: 1, challengeEndsAt: 1499n });
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.data?.release.enabled).toBe(true));
  fake.methods.call.mockRejectedValue(new Error("Dry run refused"));
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.data?.release.lockedReason).toContain("Dry run refused"));
  fake.methods.getBlock.mockRejectedValueOnce(new Error("Offline"));
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
});

it("create hook previews without a wallet and tracks policy pin success and error", async () => {
  mocks.account = undefined;
  const uri = `/ipfs/${ipfsCidV0(GENERIC_POLICY_TEXT)}`;
  const transport = { upload: vi.fn().mockResolvedValue(uri), fetch: vi.fn().mockResolvedValue(GENERIC_POLICY_TEXT) };
  const { Wrapper } = wrapper();
  const { result } = renderHook(() => useCreateEvent({ chainId: 1 }, transport), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.deployments.isSuccess).toBe(true));
  expect(result.current.preview(form, uri)).toContain("Dinner");
  expect(result.current.pin.isIdle).toBe(true);
  const pinning = deferred<string>();
  transport.upload.mockReturnValueOnce(pinning.promise);
  act(() => result.current.pin.mutate());
  await waitFor(() => expect(result.current.pin.isPending).toBe(true));
  await act(async () => pinning.resolve(uri));
  await waitFor(() => expect(result.current.pin.isSuccess).toBe(true));
  transport.fetch.mockResolvedValue("wrong");
  act(() => result.current.pin.mutate());
  await waitFor(() => expect(result.current.pin.isError).toBe(true));
});

it("deploy hook sends the creation code with no recipient and saves the new event from the receipt", async () => {
  const deployed = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  let request: Awaited<ReturnType<SendArgs["prepare"]>> | undefined;
  mocks.send.mockImplementation(async ({ prepare }: SendArgs) => {
    request = await prepare();
    return { ...receipt, contractAddress: deployed };
  });
  fake.methods.getBlock.mockResolvedValue({ number: 10n, timestamp: 1n, transactions: [] });
  const { Wrapper } = wrapper();
  const { result } = renderHook(() => useDeploy({ chainId: 1 }), { wrapper: Wrapper });
  expect(result.current.isIdle).toBe(true);
  act(() => result.current.mutate({ form, owner, policyURI }));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(request?.to).toBeUndefined();
  expect(request?.data?.startsWith(kickbackBytecode)).toBe(true);
  expect(readDeployments()).toEqual([expect.objectContaining({ address: deployed, chainId: 1, block: 11 })]);
});

it("deploy hook asks for NEW before a second event from this browser, and refuses another network", async () => {
  mocks.send.mockImplementation(async ({ prepare }: SendArgs) => prepare());
  saveDeployment({ address: zeroAddress, chainId: 1, block: 1, name: "Earlier" });
  const { Wrapper } = wrapper();
  const { result } = renderHook(() => useDeploy({ chainId: 1 }), { wrapper: Wrapper });
  act(() => result.current.mutate({ form, owner, policyURI }));
  await waitFor(() => expect(result.current.error?.message).toContain("Type NEW"));
  const other = renderHook(() => useDeploy({ chainId: 5 }), { wrapper: Wrapper });
  act(() => other.result.current.mutate({ form, owner, policyURI, confirmation: "NEW" }));
  await waitFor(() => expect(other.result.current.error?.message).toContain("cannot deploy"));
});

it("attendance gates follow chain blocks without rebuilding the uploaded list", async () => {
  const { Wrapper } = wrapper();
  fake.methods.getBlock.mockResolvedValue({ number: 10n, timestamp: 999n, transactions: [] });
  const input = { checkinCsv: null, doorCsv: `wallet\n${guest}` };
  const { result, rerender } = renderHook(() => useAttendancePlan(cfg, input, "POST", "NOSHOW"), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  await waitFor(() => expect(result.current.gates.post.lockedReason).toContain("starts"));
  fake.methods.getBlock.mockResolvedValue({ number: 11n, timestamp: 1000n, transactions: [] });
  mocks.block = 11n;
  rerender();
  await waitFor(() => expect(result.current.gates.post.enabled).toBe(true));
});

it("guests retain a manual tick through RPC refusal and refresh", async () => {
  const { encodeAbiParameters, getAbiItem, toEventSelector } = await import("viem");
  const { kickbackAbi } = await import("@kickback/contracts");
  const { row } = await import("./fixtures");
  const deposited = getAbiItem({ abi: kickbackAbi, name: "Deposited" });
  const log = {
    address,
    topics: [toEventSelector(deposited), encodeAbiParameters([{ type: "address" }], [guest])],
    data: encodeAbiParameters([{ type: "uint256" }], [10n]),
    transactionHash: row.tx,
    blockNumber: 9n,
    logIndex: 0,
  };
  fake.values.status = 0;
  fake.methods.getLogs.mockImplementation(async (request) => (request.event?.name === "Deposited" ? [log] : []));
  fake.methods.getTransaction.mockResolvedValue({
    hash: row.tx,
    to: address,
    from: guest,
    value: 10n,
    blockNumber: 9n,
  });
  fake.methods.getTransactionReceipt.mockResolvedValue({
    status: "success",
    from: guest,
    to: address,
    blockNumber: 9n,
    logs: [log],
  });
  fake.methods.getBlock.mockResolvedValue({ number: 9n, timestamp: 900n, transactions: [] });
  const { Wrapper } = wrapper();
  const { result } = renderHook(() => useGuests(cfg), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  act(() =>
    result.current.loadCsv(
      `name,email,ticket_name,approval_status,eth_address,tx\nGuest,guest@example.com,deposit,approved,${guest},${row.tx}`,
    ),
  );
  await waitFor(() => expect(result.current.rows[0]?.tick).toBe("register"));
  act(() => result.current.setTick(result.current.rows[0]!.id, "refund"));
  expect(result.current.rows[0]?.tick).toBe("refund");
  act(() => result.current.setTick(result.current.rows[0]!.id, null));
  fake.methods.getCode.mockRejectedValueOnce(new Error("Offline"));
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.rows[0]?.tick).toBeNull();
});
