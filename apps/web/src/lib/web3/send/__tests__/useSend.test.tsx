import type { ReactNode } from "react";

import { kickbackAbi } from "@kickback/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createPublicClient, custom, encodeErrorResult, type Address, type Hash } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const EVENT: Address = "0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D";
const HASH: Hash = `0x${"ab".repeat(32)}`;

const wagmiCore = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getConnectorClient: vi.fn(async () => ({})),
  getPublicClient: vi.fn(),
  sendTransaction: vi.fn(async () => `0x${"ab".repeat(32)}`),
}));
const walletChain = vi.hoisted(() => ({ getChainId: vi.fn() }));

vi.mock("@/lib/web3/wagmi", () => ({ wagmiConfig: {} }));
vi.mock("@wagmi/core", () => wagmiCore);
vi.mock("viem/actions", () => walletChain);
vi.mock("wagmi", () => ({ useAccount: () => ({ address: ALICE }) }));

const notFound = (name: string) => Object.assign(new Error(name), { name });

function fakeClient() {
  return {
    call: vi.fn(async () => ({ data: undefined })),
    estimateGas: vi.fn(async () => 100_000n),
    getTransactionCount: vi.fn(async () => 0),
    getTransaction: vi.fn(async () => ({ nonce: 0 })),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success", transactionHash: HASH })),
    getTransactionReceipt: vi.fn(async (): Promise<unknown> => {
      throw notFound("TransactionReceiptNotFoundError");
    }),
  };
}

async function load(chain: "hardhat" | "mainnet-fork", connectorId = "mock") {
  vi.stubEnv("NEXT_PUBLIC_CHAIN", chain);
  vi.resetModules();
  const client = fakeClient();
  wagmiCore.getPublicClient.mockReturnValue(client);
  wagmiCore.getAccount.mockReturnValue({ address: ALICE, connector: { id: connectorId, uid: `${connectorId}-1` } });
  walletChain.getChainId.mockResolvedValue(chain === "hardhat" ? 31337 : 1);
  const send = await import("../useSend");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...send, client, wrapper, queryClient };
}

const deposit = { prepare: async () => ({ to: EVENT, data: "0xd0e30db0" as const, value: 1n }) };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("useSend", () => {
  it("pins the configured chain on the request", async () => {
    const { useSend, wrapper } = await load("hardhat");
    const { result } = renderHook(() => useSend(), { wrapper });
    await act(() => result.current.mutateAsync(deposit));
    expect(wagmiCore.sendTransaction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ chainId: 31337, gas: 130_000n }),
    );
  });

  it("pins the same connector for the chain check and send", async () => {
    const { useSend, wrapper } = await load("mainnet-fork");
    const connector = wagmiCore.getAccount().connector;
    const { result } = renderHook(() => useSend(), { wrapper });
    await act(() => result.current.mutateAsync(deposit));
    expect(wagmiCore.getConnectorClient).toHaveBeenCalledWith({}, expect.objectContaining({ connector }));
    expect(wagmiCore.sendTransaction).toHaveBeenCalledWith({}, expect.objectContaining({ connector }));
  });

  it("refuses a connector switch with the same address during the chain check", async () => {
    const { useSend, wrapper } = await load("mainnet-fork");
    walletChain.getChainId.mockImplementationOnce(async () => {
      wagmiCore.getAccount.mockReturnValue({ address: ALICE, connector: { id: "injected", uid: "real-1" } });
      return 1;
    });
    const { result } = renderHook(() => useSend(), { wrapper });
    await expect(act(() => result.current.mutateAsync(deposit))).rejects.toMatchObject({ kind: "account-changed" });
    expect(wagmiCore.sendTransaction).not.toHaveBeenCalled();
  });

  it("explains a raw TooEarly dry-run revert with the default decoder", async () => {
    const { useSend, wrapper } = await load("hardhat");
    const rpc = vi.fn(async () => {
      throw {
        code: 3,
        message: "execution reverted",
        data: encodeErrorResult({ abi: kickbackAbi, errorName: "TooEarly" }),
      };
    });
    wagmiCore.getPublicClient.mockReturnValue(
      createPublicClient({ transport: custom({ request: rpc }, { retryCount: 0 }) }),
    );
    const { result } = renderHook(() => useSend(), { wrapper });
    await expect(act(() => result.current.mutateAsync(deposit))).rejects.toMatchObject({
      kind: "refused",
      message:
        "This would fail, so nothing was sent: Too early: check the times in the status (list opens at the event start; payouts and settling wait for the windows to end).",
    });
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ method: "eth_call" }), undefined);
    expect(wagmiCore.sendTransaction).not.toHaveBeenCalled();
  });

  it("keeps no browser record unless asked to", async () => {
    const { useSend, wrapper } = await load("hardhat");
    const { result } = renderHook(() => useSend(), { wrapper });
    await act(() => result.current.mutateAsync(deposit));
    expect(localStorage.length).toBe(0);

    const recorded = renderHook(() => useSend({ record: true }), { wrapper });
    await act(() => recorded.result.current.mutateAsync(deposit));
    expect(localStorage.getItem(`kickback:sent-tx:31337:${EVENT.toLowerCase()}`)).toContain(HASH);
  });

  it("on a mainnet fork, refuses a wallet other than the dev wallet", async () => {
    const { useSend, wrapper } = await load("mainnet-fork", "injected");
    const { result } = renderHook(() => useSend(), { wrapper });
    await expect(act(() => result.current.mutateAsync(deposit))).rejects.toMatchObject({ kind: "wrong-chain" });
    expect(wagmiCore.sendTransaction).not.toHaveBeenCalled();
  });

  it("on a mainnet fork, sends with the dev wallet", async () => {
    const { useSend, wrapper } = await load("mainnet-fork", "mock");
    const { result } = renderHook(() => useSend(), { wrapper });
    await act(() => result.current.mutateAsync(deposit));
    expect(wagmiCore.sendTransaction).toHaveBeenCalledWith({}, expect.objectContaining({ chainId: 1 }));
  });
});

describe("useSentTx", () => {
  it("starts watching a newly saved send and stays pending after receipt waiting times out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { useSend, useSentTx, useSendBusy, client, wrapper } = await load("hardhat");
    let timeout!: (error: Error) => void;
    client.waitForTransactionReceipt.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          timeout = reject;
        }),
    );
    const watcher = renderHook(() => ({ sent: useSentTx(EVENT), busy: useSendBusy() }), { wrapper });
    await vi.waitFor(() => expect(watcher.result.current.sent.data).toBeNull());
    const sender = renderHook(() => useSend({ record: true }), { wrapper });
    let sending!: Promise<unknown>;
    act(() => {
      sending = sender.result.current.mutateAsync(deposit).catch((error: unknown) => error);
    });
    await vi.waitFor(() => expect(client.waitForTransactionReceipt).toHaveBeenCalled());
    expect(localStorage.getItem(`kickback:sent-tx:31337:${EVENT.toLowerCase()}`)).toContain(HASH);
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(watcher.result.current.sent.data).toMatchObject({ record: { hash: HASH }, outcome: "pending" });
    await act(async () => {
      timeout(new Error("receipt timeout"));
      expect(await sending).toMatchObject({ kind: "unconfirmed" });
    });
    await vi.waitFor(() => expect(watcher.result.current.busy).toBe(false));
    expect(watcher.result.current.sent.data?.outcome).toBe("pending");
    client.getTransactionReceipt.mockResolvedValue({ status: "success" });
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    await vi.waitFor(() => expect(watcher.result.current.sent.data?.outcome).toBe("mined"));
  });

  it("does not let an older reconciliation overwrite a newly saved hash", async () => {
    const { sentTxStore, useSend, useSentTx, client, wrapper, queryClient } = await load("hardhat");
    const oldHash: Hash = `0x${"cd".repeat(32)}`;
    sentTxStore.save({ hash: oldHash, account: ALICE, contract: EVENT, chainId: 31337, at: Date.now(), txNonce: 0 });
    let finishOldRead!: (receipt: { status: "success" }) => void;
    client.getTransactionReceipt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldRead = resolve;
        }),
    );
    client.waitForTransactionReceipt.mockRejectedValueOnce(new Error("receipt timeout"));
    const watcher = renderHook(() => useSentTx(EVENT), { wrapper });
    await vi.waitFor(() => expect(client.getTransactionReceipt).toHaveBeenCalledWith({ hash: oldHash }));
    const sender = renderHook(() => useSend({ record: true }), { wrapper });
    await act(async () => {
      await expect(sender.result.current.mutateAsync(deposit)).rejects.toMatchObject({ kind: "unconfirmed" });
    });
    await vi.waitFor(() =>
      expect(watcher.result.current.data).toMatchObject({ record: { hash: HASH }, outcome: "pending" }),
    );
    await act(async () => {
      finishOldRead({ status: "success" });
    });
    expect(queryClient.getQueryData(["sent-tx", 31337, EVENT.toLowerCase(), ALICE.toLowerCase()])).toMatchObject({
      record: { hash: HASH },
      outcome: "pending",
    });
    expect(watcher.result.current.data).toMatchObject({ record: { hash: HASH }, outcome: "pending" });
  });

  it("checks a pending record again every few seconds, and stops once it settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { sentTxStore, useSentTx, client, wrapper } = await load("hardhat");
    sentTxStore.save({ hash: HASH, account: ALICE, contract: EVENT, chainId: 31337, at: Date.now(), txNonce: 0 });

    const { result } = renderHook(() => useSentTx(EVENT), { wrapper });
    await vi.waitFor(() => expect(result.current.data?.outcome).toBe("pending"));
    const reads = client.getTransactionReceipt.mock.calls.length;

    client.getTransactionReceipt.mockResolvedValue({ status: "success" });
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    await vi.waitFor(() => expect(result.current.data?.outcome).toBe("mined"));
    expect(client.getTransactionReceipt.mock.calls.length).toBeGreaterThan(reads);

    const settled = client.getTransactionReceipt.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(client.getTransactionReceipt.mock.calls.length).toBe(settled);
  });
});
