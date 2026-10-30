import { kickbackAbi } from "@kickback/contracts";
import { decodeFunctionData } from "viem";
import { expect, it } from "vitest";

import { address, guest, mockClient } from "./moneyFixtures";
import { guestMoneyRequest, prepareGuestMoney, readGuestMoney } from "../guestMoney";

it.each(["withdraw", "claim"] as const)("encodes %s to the connected wallet with zero value", (action) => {
  const request = guestMoneyRequest(address, guest, action);
  expect(request).toMatchObject({ to: address, value: 0n });
  expect(decodeFunctionData({ abi: kickbackAbi, data: request.data })).toEqual({
    functionName: action === "withdraw" ? "emergencyWithdraw" : "claim",
    args: [guest],
  });
});

it("reads money state at one block, including owed before declaring an attendee paid", async () => {
  const { client, methods, values } = mockClient();
  Object.assign(values, { owed: 5n, attended: true, phase: 2 });
  expect(await readGuestMoney(client, address, guest)).toEqual({
    status: 1,
    owed: 5n,
    attended: true,
    payoutShare: 10n,
    phase: 2,
  });
  for (const [args] of methods.readContract.mock.calls) expect(args).toMatchObject({ blockNumber: 10n, address });
});

it("refuses a claim whose amount no longer matches the ticket", async () => {
  const { client, values } = mockClient();
  values.owed = 5n;
  await expect(prepareGuestMoney(client, address, guest, "claim", 10n)).rejects.toThrow("The amount changed");
  expect(await prepareGuestMoney(client, address, guest, "claim", 5n)).toEqual(
    guestMoneyRequest(address, guest, "claim"),
  );
});
