import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { getAddress } from "viem";
import { beforeEach, expect, it, vi } from "vitest";

import { cfg, guest, owner, scope, stamp, row, checked, guestCheck } from "./fixtures";
import { GuestsView } from "../components/GuestsView";
import { useAttendanceScreen } from "../hooks/useAttendanceScreen";
import { useGuestsScreen } from "../hooks/useGuestsScreen";
import { usePayoutScreen } from "../hooks/usePayoutScreen";
import { guestRows } from "../model/guests";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  refresh: vi.fn(),
  lists: [] as unknown[],
  placeholder: false,
  rows: [] as ReturnType<typeof guestRows>,
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
    rows: mocks.rows,
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
  mocks.rows = [];
  mocks.lists = [stamp(), { ...stamp(), items: [{ ...stamp().items[0]!, wallet: owner }] }];
});

it.each(["register", "refund"] as const)("the %s screen refreshes only the unsent batches", async (action) => {
  mocks.refresh.mockImplementation(async (remaining) =>
    remaining.map((list: ReturnType<typeof stamp>) => ({ ...list, block: 11 })),
  );
  const { result } = renderHook(() => useGuestsScreen(cfg, scope));
  act(() => result.current[action]());
  expect(mocks.send).not.toHaveBeenCalled();
  await act(() => result.current.confirm());
  await waitFor(() => expect(result.current.done).not.toBeNull());
  expect(mocks.send.mock.calls.map(([input]) => input.list.block)).toEqual([10, 11]);
  expect(mocks.refresh).toHaveBeenCalledWith([mocks.lists[1]], action);
});

it("stops the batch flow when a fresh check refuses", async () => {
  mocks.refresh.mockRejectedValue(new Error("Remaining guest changed"));
  const { result } = renderHook(() => useGuestsScreen(cfg, scope));
  act(() => result.current.register());
  expect(mocks.send).not.toHaveBeenCalled();
  await act(() => result.current.confirm());
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

it.each(["register", "refund"] as const)("freezes the %s wallet list and amount until confirmation", async (action) => {
  const original = mocks.lists;
  let finish!: () => void;
  mocks.send.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  mocks.refresh.mockImplementation(async (remaining) => remaining);
  const { result } = renderHook(() => useGuestsScreen(cfg, scope));
  act(() => result.current[action]());
  expect(result.current.frozen).toMatchObject({ wallets: [guest, owner], total: 20n });
  mocks.lists = [stamp()];
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.confirm();
  });
  act(() => result.current.close());
  expect(result.current.frozen).not.toBeNull();
  await act(() => result.current.confirm());
  expect(mocks.send).toHaveBeenCalledOnce();
  await act(async () => {
    finish();
    await pending;
  });
  expect(mocks.send.mock.calls.map(([input]) => input.list)).toEqual(original);
});

it("prefills Return stray ETH without sending and does not reopen it after dismissal", async () => {
  const { result, rerender } = renderHook(() => usePayoutScreen(scope, 10n, { to: guest, amount: "0.005" }));
  expect(result.current.frozen?.action).toBe("refund");
  expect(result.current.fields).toMatchObject({ to: guest, amount: "0.005" });
  expect(mocks.send).not.toHaveBeenCalled();
  await act(() => result.current.confirm(""));
  expect(mocks.send).toHaveBeenCalledWith({ to: guest, amount: 5000000000000000n });
  rerender();
  expect(result.current.frozen).toBeNull();
});

it("counts and filters only eligible action rows, including a declined payer and an ineligible short payer", () => {
  const declined = { ...checked, decision: "declined" as const, approval: "declined" };
  mocks.rows = guestRows(
    [row, { ...row, from: owner, code: "AMOUNT_TOO_LOW", amount: 5n, held: 5n, canRegister: false, canRefund: false }],
    guestCheck({ verified: [declined], newStakers: [], refunds: [declined] }),
  );
  const { result } = renderHook(() => useGuestsScreen(cfg, scope));
  expect(result.current.counts).toEqual({ all: 2, register: 0, refund: 1, look: 1 });
  expect(result.current.rows.find((r) => r.wallet === owner)?.returnHref).toContain(
    `returnTo=${owner}&returnAmount=0.000000000000000005`,
  );
  act(() => result.current.setFilter("refund"));
  expect(result.current.rows).toHaveLength(1);
  expect(result.current.rows.every((r) => r.canRefund.enabled)).toBe(true);
});

it("distinguishes five refundable guests from the one selected refund", () => {
  const approved = Array.from({ length: 4 }, (_, i) => ({
    ...checked,
    email: `${i}@example.com`,
    wallet: getAddress(`0x${String(i + 4).repeat(40)}`),
    tx: `0x${String(i + 4).repeat(64)}`,
  }));
  const declined = { ...checked, email: "declined@example.com", decision: "declined" as const };
  mocks.rows = guestRows(
    [...approved, declined].map((r) => ({ ...row, from: getAddress(r.wallet), tx: r.tx })),
    guestCheck({ verified: [...approved, declined], newStakers: approved, refunds: [declined] }),
  );
  const { result } = renderHook(() => useGuestsScreen(cfg, scope));
  expect(result.current.counts.refund).toBe(5);
  expect(result.current.toRefund).toBe(1);
  act(() => result.current.setFilter("refund"));
  expect(result.current.rows).toHaveLength(5);
  expect(result.current.rows.every((r) => r.canRefund.enabled)).toBe(true);
  render(<GuestsView model={result.current} />);
  expect(screen.getByRole("button", { name: "Refundable 5" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refund 1" })).toBeInTheDocument();
});
