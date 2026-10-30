import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { Address, Hash } from "viem";
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
  wagmiCore.getAccount.mockReturnValue({ address: ALICE, connector: { id: connectorId } });
  walletChain.getChainId.mockResolvedValue(chain === "hardhat" ? 31337 : 1);
  const send = await import("../useSend");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...send, client, wrapper };
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
    expect(wagmiCore.sendTransaction).toHaveBeenCalledWith({}, expect.objectContaining({ chainId: 31337 }));
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
  it("checks a pending record again every few seconds, and stops once it settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { sentTxStore, useSentTx, client, wrapper } = await load("hardhat");
    sentTxStore.save({ hash: HASH, account: ALICE, contract: EVENT, chainId: 31337, at: Date.now(), nonce: 0 });

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
