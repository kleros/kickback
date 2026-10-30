import type { PropsWithChildren } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useDeposit } from "./useDeposit";

const mocks = vi.hoisted(() => ({ account: "0x1111111111111111111111111111111111111111", mutate: vi.fn() }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.account }), usePublicClient: () => ({}) }));
vi.mock("@/lib/web3/send", () => ({ useSend: () => ({ mutate: mocks.mutate }) }));

it("retains the sending account when the wallet changes after a deposit", () => {
  const queryClient = new QueryClient();
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const { result, rerender } = renderHook(() => useDeposit("0x3333333333333333333333333333333333333333", 10n), {
    wrapper: Wrapper,
  });
  act(() => result.current.deposit());
  const sender = mocks.account;
  mocks.account = "0x2222222222222222222222222222222222222222";
  rerender();
  expect(result.current.account).toBe(sender);
  expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ expectedAccount: sender }));
});
