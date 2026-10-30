import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const chain = vi.hoisted(() => ({
  blockNumber: 7n as bigint | undefined,
  getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
    number: blockNumber,
    timestamp: 1_700_000_000n + blockNumber * 86_400n,
  })),
}));

vi.mock("wagmi", () => ({
  usePublicClient: () => ({ getBlock: chain.getBlock }),
  useBlockNumber: () => ({ data: chain.blockNumber }),
}));

const { useChainTime } = await import("../useChainTime");

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

afterEach(() => {
  vi.useRealTimers();
});

describe("useChainTime", () => {
  it("is the watched block's timestamp, and follows each new block, whatever the laptop clock says", async () => {
    vi.useFakeTimers({ now: new Date("2001-01-01T00:00:00Z"), shouldAdvanceTime: true });
    chain.blockNumber = 7n;
    const { result, rerender } = renderHook(() => useChainTime(31337), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ blockNumber: 7n, now: 1_700_604_800 }));
    expect(chain.getBlock).toHaveBeenLastCalledWith({ blockNumber: 7n });

    chain.blockNumber = 8n;
    rerender();
    await waitFor(() => expect(result.current.data).toEqual({ blockNumber: 8n, now: 1_700_691_200 }));
    expect(chain.getBlock).toHaveBeenLastCalledWith({ blockNumber: 8n });
  });
});
