import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { form, owner } from "./fixtures";
import { useCreateScreen } from "../hooks/useCreateScreen";

const mocks = vi.hoisted(() => ({ pin: vi.fn(), deploy: vi.fn(), owner: "", busy: false }));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.owner }) }));
vi.mock("@/lib/web3/send", () => ({ useSendBusy: () => mocks.busy }));
vi.mock("../hooks/useCreateEvent", () => ({
  useCreateEvent: () => ({
    preview: () => "Preview",
    deployments: { data: [] },
    pin: { mutateAsync: mocks.pin },
    deploy: { mutateAsync: mocks.deploy },
  }),
}));

beforeEach(() => {
  mocks.owner = owner;
  mocks.busy = false;
  mocks.pin.mockReset().mockResolvedValue("/ipfs/policy");
  mocks.deploy.mockReset().mockResolvedValue({ contractAddress: owner, blockNumber: 20n });
});

it("opens with frozen deploy figures and signs that form and owner, not later edits", async () => {
  const { result, rerender } = renderHook(() => useCreateScreen());
  act(() => {
    for (const [name, value] of Object.entries(form)) result.current.setField(name, String(value));
  });
  act(() => result.current.deploy());
  expect(mocks.pin).not.toHaveBeenCalled();
  expect(mocks.deploy).not.toHaveBeenCalled();
  expect(result.current.frozen).toMatchObject({
    owner,
    eventName: "Dinner",
    deposit: 10n ** 16n,
    start: Date.parse("2027-01-01T12:30:00Z") / 1000,
    deadline: Date.parse("2027-01-15T12:30:00Z") / 1000,
  });
  act(() => result.current.setField("deposit", "0.5"));
  mocks.owner = "0x4444444444444444444444444444444444444444";
  rerender();
  await act(() => result.current.confirm());
  expect(mocks.deploy).toHaveBeenCalledWith(
    expect.objectContaining({ owner, form: expect.objectContaining({ deposit: "0.01" }) }),
  );
  expect(result.current.frozen).toBeNull();
});

it("cannot dismiss or confirm twice while pinning", async () => {
  let finish!: (value: string) => void;
  mocks.pin.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = renderHook(() => useCreateScreen());
  act(() => {
    for (const [name, value] of Object.entries(form)) result.current.setField(name, String(value));
  });
  act(() => result.current.deploy());
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.confirm();
  });
  act(() => result.current.close());
  expect(result.current.frozen).not.toBeNull();
  expect(result.current.step).toBe("pinning");
  await act(() => result.current.confirm());
  expect(mocks.pin).toHaveBeenCalledOnce();
  await act(async () => {
    finish("/ipfs/policy");
    await pending;
  });
  expect(mocks.deploy).toHaveBeenCalledOnce();
});
