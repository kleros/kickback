import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { cfg, guest, owner, scope, stamp } from "./fixtures";
import { useAttendanceScreen } from "../hooks/useAttendanceScreen";
import { useGuestsScreen } from "../hooks/useGuestsScreen";
import { usePayoutScreen } from "../hooks/usePayoutScreen";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  refresh: vi.fn(),
  lists: [] as unknown[],
  placeholder: false,
}));
vi.mock("@/lib/web3/send", () => ({ useSendBusy: () => false }));
vi.mock("../hooks/useActions", () => {
  const mutation = () => ({ mutateAsync: mocks.send, isPending: false, isSuccess: false });
  return Object.fromEntries(
    [
      "useRegisterStakers",
      "useRejectAndRefund",
      "useAddAttendees",
      "usePostAttendance",
      "useCancel",
      "useRefund",
      "useReleasePayouts",
      "useReturnToken",
      "useSweep",
    ].map((name) => [name, mutation]),
  );
});
vi.mock("../hooks/useGuests", () => ({
  useGuests: () => ({
    rows: [],
    selectedBatches: () => mocks.lists,
    refreshBatches: mocks.refresh,
  }),
}));
vi.mock("../hooks/useAttendancePlan", () => ({
  useAttendancePlan: () => ({
    gates: { post: { enabled: false, lockedReason: "Posted" }, add: { enabled: true, lockedReason: null } },
  }),
}));
vi.mock("../hooks/usePayoutActions", () => ({
  usePayoutActions: (_scope: unknown, input?: { token?: string; amount?: bigint }) => {
    const gate = { enabled: true, lockedReason: null };
    return {
      isPlaceholderData: mocks.placeholder,
      data: {
        release: gate,
        sweep: gate,
        cancel: gate,
        refund: gate,
        removeGuest: gate,
        returnToken:
          input?.token && input.amount && input.amount <= 1000000n
            ? gate
            : {
                enabled: false,
                lockedReason: input?.token ? "Enter an amount to return." : "Read the token balance first.",
              },
        token: input?.token ? { balance: 1000000n, symbol: "USDC", decimals: 6 } : null,
      },
    };
  },
}));
beforeEach(() => {
  mocks.send.mockReset().mockResolvedValue({});
  mocks.refresh.mockReset();
  mocks.placeholder = false;
  mocks.lists = [stamp(), { ...stamp(), items: [{ ...stamp().items[0]!, wallet: owner }] }];
});

it.each(["register", "refund"] as const)("the %s screen refreshes only the unsent batches", async (action) => {
  mocks.refresh.mockImplementation(async (remaining) =>
    remaining.map((list: ReturnType<typeof stamp>) => ({ ...list, block: 11 })),
  );
  const { result } = renderHook(() => useGuestsScreen(cfg, scope));
  act(() => result.current[action]());
  await waitFor(() => expect(result.current.done).not.toBeNull());
  expect(mocks.send.mock.calls.map(([input]) => input.list.block)).toEqual([10, 11]);
  expect(mocks.refresh).toHaveBeenCalledWith([mocks.lists[1]], action);
});

it("stops the batch flow when a fresh check refuses", async () => {
  mocks.refresh.mockRejectedValue(new Error("Remaining guest changed"));
  const { result } = renderHook(() => useGuestsScreen(cfg, scope));
  act(() => result.current.register());
  await waitFor(() => expect(result.current.error?.text).toBe("Remaining guest changed"));
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(result.current.done).toBeNull();
});

it("sends the registered attendance correction through its guarded mutation", async () => {
  const { result } = renderHook(() => useAttendanceScreen(cfg, scope));
  act(() => result.current.correction.setWallets(guest));
  await act(() => result.current.correction.confirm());
  expect(mocks.send).toHaveBeenCalledWith({ wallets: [guest] });
  expect(result.current.correction.wallets).toBe("");
});

it("sends token recovery with the selected token, recipient, and integer units", async () => {
  const { result } = renderHook(() => usePayoutScreen(scope, 10n));
  act(() => result.current.open("returnToken"));
  act(() => {
    result.current.setField("token", guest);
    result.current.setField("to", owner);
    result.current.setField("amount", "1000000");
  });
  expect(result.current.dialogGate?.enabled).toBe(true);
  await act(() => result.current.confirm(""));
  expect(mocks.send).toHaveBeenCalledWith({ token: guest, to: owner, amount: 1000000n });
  expect(result.current.done).toBe("Tokens returned.");
});

it("does not enable recovery using another token's placeholder balance", () => {
  const { result, rerender } = renderHook(() => usePayoutScreen(scope, 10n));
  act(() => result.current.open("returnToken"));
  act(() => {
    result.current.setField("token", guest);
    result.current.setField("to", owner);
    result.current.setField("amount", "1");
  });
  mocks.placeholder = true;
  rerender();
  expect(result.current.dialogGate?.enabled).toBe(false);
  expect(result.current.token).toBeNull();
});
