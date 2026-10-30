import type { PropsWithChildren } from "react";

import { kickbackAbi } from "@kickback/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { decodeFunctionData, type PublicClient } from "viem";
import { expect, it, vi } from "vitest";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { useGuestMoney } from "./useGuestMoney";
import { address, guest, mockClient } from "../operations/__tests__/moneyFixtures";

const mocks = vi.hoisted(() => ({
  account: "",
  mutate: vi.fn(),
  client: undefined as PublicClient | undefined,
  public: vi.fn(),
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mocks.account }),
  usePublicClient: (input: unknown) => {
    mocks.public(input);
    return mocks.client;
  },
}));
vi.mock("@/lib/web3/send", () => ({ useSend: () => ({ mutate: mocks.mutate, status: "idle" }) }));

it.each(["withdraw", "claim"] as const)(
  "routes %s through useSend with a pinned client and the initiating wallet",
  async (action) => {
    mocks.account = guest;
    mocks.mutate.mockClear();
    const fake = mockClient();
    Object.assign(fake.values, { owed: 5n, attended: true });
    mocks.client = fake.client;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: PropsWithChildren) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const { result, rerender } = renderHook(() => useGuestMoney(address, 10n), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.query.data).toBeDefined());
    act(() => result.current[action]());
    const request = mocks.mutate.mock.calls[0]![0];
    mocks.account = address;
    rerender();
    expect(result.current.send.account).toBe(guest);
    expect(request.expectedAccount).toBe(guest);
    const prepared = await request.prepare();
    expect(decodeFunctionData({ abi: kickbackAbi, data: prepared.data })).toEqual({
      functionName: action === "withdraw" ? "emergencyWithdraw" : "claim",
      args: [guest],
    });
    expect(prepared.value).toBe(0n);
    expect(mocks.public).toHaveBeenCalledWith({ chainId: DEFAULT_CHAIN_ID });
  },
);
