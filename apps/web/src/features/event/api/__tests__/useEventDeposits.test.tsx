import type { PropsWithChildren } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { AbiEvent, Address, Hash } from "viem";
import { expect, it, vi } from "vitest";

import { useBlockTime, useEventDeposits } from "../useEvent";

const client = vi.hoisted(() => ({
  getLogs: vi.fn(),
  getBlockNumber: vi.fn().mockResolvedValue(20n),
  getBlock: vi.fn(),
}));
vi.mock("wagmi", () => ({ usePublicClient: () => client }));
const contract: Address = "0x1111111111111111111111111111111111111111";
const wallet: Address = "0x2222222222222222222222222222222222222222";
const tx: Hash = `0x${"ab".repeat(32)}`;

it("requests and folds Refunded and Payout logs, then dates the actual return block", async () => {
  client.getLogs.mockImplementation(async ({ events }: { events: AbiEvent[] }) =>
    [
      {
        eventName: "Deposited",
        args: { from: wallet, amount: 5000000000000000n },
        blockNumber: 10n,
        transactionHash: tx,
      },
      { eventName: "Refunded", args: { to: wallet, amount: 5000000000000000n }, blockNumber: 11n, transactionHash: tx },
      {
        eventName: "Payout",
        args: { to: contract, amount: 10000000000000000n },
        blockNumber: 12n,
        transactionHash: tx,
      },
    ].filter((log) => events.some((event) => event.name === log.eventName)),
  );
  client.getBlock.mockResolvedValue({ timestamp: 1793368800n });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const { result } = renderHook(
    () => {
      const deposits = useEventDeposits(contract, 1, 10000000000000000n);
      const mine = deposits.data?.byWallet.get(wallet);
      const time = useBlockTime(mine?.returned?.block);
      return { deposits, mine, time };
    },
    { wrapper: Wrapper },
  );
  await waitFor(() => expect(result.current.time.data).toBe(1793368800));
  expect(result.current.mine?.returned).toEqual({ amount: 5000000000000000n, block: 11n });
  expect(result.current.deposits.data?.byWallet.get(contract)?.payoutTx).toBe(tx);
  expect(result.current.deposits.data?.guests).toBe(1);
  expect(client.getBlock).toHaveBeenCalledWith({ blockNumber: 11n });
});

it("reads registration logs so a later payment cannot replace the staked receipt", async () => {
  const extra: Hash = `0x${"cd".repeat(32)}`;
  const amount = 10000000000000000n;
  client.getLogs.mockImplementation(async ({ events }: { events: AbiEvent[] }) =>
    [
      { eventName: "Deposited", args: { from: wallet, amount }, blockNumber: 10n, transactionHash: tx },
      { eventName: "StakerRegistered", args: { staker: wallet }, blockNumber: 11n, transactionHash: tx },
      { eventName: "Deposited", args: { from: wallet, amount }, blockNumber: 12n, transactionHash: extra },
    ].filter((log) => events.some((event) => event.name === log.eventName)),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const { result } = renderHook(() => useEventDeposits(contract, 1, amount), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.byWallet.get(wallet)?.txHash).toBe(tx);
});
