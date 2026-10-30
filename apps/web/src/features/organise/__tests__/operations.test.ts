import { kickbackAbi } from "@kickback/contracts";
import { encodeAbiParameters, getAbiItem, toEventSelector, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

import { address, cfg, event, guest, guestCheck, mockClient, owner, plan, row, scope, stamp } from "./fixtures";
import { prepareAction, validRecipient } from "../operations/actions";
import { readAttendancePlan } from "../operations/attendance";
import { checkSnapshot, readGuests, selectedGuestList } from "../operations/guests";
import { openEvent, readEventState, readRelease } from "../operations/read";

it("checks runtime fingerprint, reads a single block and flags non-Kleros resolvers", async () => {
  const { client, methods, values } = mockClient();
  const state = await readEventState(client, scope);
  expect(state.event).toEqual(event);
  expect(state.now).toBe(1500);
  expect(methods.readContract.mock.calls.every(([args]) => "blockNumber" in args && args.blockNumber === 10n)).toBe(
    true,
  );
  methods.getCode.mockResolvedValueOnce("0x");
  await expect(readEventState(client, scope)).rejects.toThrow("no contract");
  methods.getCode.mockResolvedValueOnce("0x1234");
  await expect(readEventState(client, scope)).rejects.toThrow("code");
  methods.getBlock.mockResolvedValueOnce({ number: null, timestamp: 1n });
  await expect(readEventState(client, scope)).rejects.toThrow("confirmed");
  methods.getBlock.mockResolvedValue({ number: 10n, timestamp: 1500n, transactions: [{ hash: "0xabc", to: null }] });
  methods.getTransactionReceipt.mockResolvedValue({ contractAddress: address });
  const result = await openEvent(client, { ...scope, deployBlock: 1 }, { chainId: 1 });
  expect(result.verifiedKleros).toBe(true);
  values.disputeResolver = guest;
  expect((await openEvent(client, { ...scope, deployBlock: 1 }, { chainId: 1 })).verifiedKleros).toBe(false);
});

it("finds a deploy block when absent and refuses an unconfirmed supplied block", async () => {
  const { client, methods } = mockClient();
  methods.getBlock.mockResolvedValue({ number: 10n, timestamp: 1500n, transactions: [{ hash: "0xabc", to: null }] });
  methods.getTransactionReceipt.mockResolvedValue({ contractAddress: address });
  expect((await openEvent(client, scope, { chainId: 1 })).deployBlock).toBe(0);
  methods.getTransactionReceipt.mockResolvedValue({ contractAddress: guest });
  await expect(openEvent(client, { ...scope, deployBlock: 0 }, { chainId: 1 })).rejects.toThrow("confirm");
});

describe("payout dry run", () => {
  it("requires a passing eth_call and respects strict deadline boundaries", async () => {
    const { client, methods, values } = mockClient();
    values.phase = 1;
    values.challengeEndsAt = 1500n;
    expect((await readRelease(client, await readEventState(client, scope))).enabled).toBe(false);
    expect(methods.call).not.toHaveBeenCalled();
    values.challengeEndsAt = 1499n;
    expect((await readRelease(client, await readEventState(client, scope))).enabled).toBe(true);
    methods.call.mockRejectedValue(new Error("challenge window still open"));
    const failed = await readRelease(client, await readEventState(client, scope));
    expect(failed.enabled).toBe(false);
    expect(failed.lockedReason).toContain("challenge window");
  });
  it("offers only expired unmatched challenges, one transaction at a time", async () => {
    const { client, methods, values } = mockClient();
    Object.assign(values, {
      phase: 1,
      challengeEndsAt: 1001n,
      challengers: [guest],
      challenges: [1, zeroAddress, 1499n],
    });
    methods.estimateGas.mockResolvedValue(16777216n);
    const release = await readRelease(client, await readEventState(client, scope));
    expect(release.wallets).toEqual([guest]);
    await expect(
      prepareAction(client, scope, owner, {
        name: "resolveChallenge",
        input: { wallet: guest, confirmation: "SETTLE" },
      }),
    ).resolves.toHaveProperty("data");
    values.challenges = [2, owner, 0n];
    await expect(
      prepareAction(client, scope, owner, {
        name: "resolveChallenge",
        input: { wallet: guest, confirmation: "SETTLE" },
      }),
    ).rejects.toThrow("Only expired");
    values.challenges = [1, zeroAddress, 1500n];
    expect((await readRelease(client, await readEventState(client, scope))).lockedReason).toContain(
      "waiting for a match",
    );
  });
});

it.each(["Deposited", "Rejected", "Refunded", "StakerRegistered", "AttendancePosted", "Cancelled"] as const)(
  "refuses a %s log after the snapshot even without a status change",
  async (name) => {
    const { client, methods, values } = mockClient();
    values.status = 0;
    methods.getBlockNumber.mockResolvedValue(11n);
    methods.getLogs.mockImplementation(async (request) =>
      request.events.some((e: { name: string }) => e.name === name) ? [{ blockNumber: 11n }] : [],
    );
    await expect(checkSnapshot(client, cfg, stamp())).rejects.toThrow("since the check");
  },
);

it("refuses stale statuses and permits a snapshot with no intervening changes", async () => {
  const { client, values } = mockClient();
  await expect(checkSnapshot(client, cfg, stamp())).rejects.toThrow("since the check");
  values.status = 0;
  await expect(checkSnapshot(client, cfg, stamp())).resolves.toBeUndefined();
});

it("builds real attendance plans from check-ins plus door wallets", async () => {
  const { client } = mockClient();
  const result = await readAttendancePlan(client, cfg, {
    checkinCsv: "email,checked_in_at\nguest@example.com,yes",
    verified: [{ wallet: guest, email: "guest@example.com" }],
    doorCsv: `wallet\n${guest}`,
  });
  expect(result.attendees).toBe(1);
  expect(result.share).toBe(10n);
  expect(result.downloads.csv).toContain(guest);
  const unknown = await readAttendancePlan(client, cfg, { checkinCsv: null, doorCsv: `wallet\n${guest}` });
  expect(unknown.unmatchedStakers).toEqual([guest]);
});

it("loads deposits without a CSV, rejects malformed CSV and stamps selections", async () => {
  const { client } = mockClient();
  expect((await readGuests(client, cfg, null)).snapshotBlock).toBe(10);
  await expect(readGuests(client, cfg, "not,a,luma,list\none,two,three,four")).rejects.toThrow("tx-link");
  const check = guestCheck();
  const data = {
    overview: { deposits: [row], returns: [], check },
    check,
    stamp: stamp(),
    snapshotBlock: 10,
    statusOf: check.statusOf,
  };
  expect(selectedGuestList(data, {}, "register").items[0]?.wallet).toBe(guest);
});

it("verifies a real pasted Luma transaction using only the fake public client", async () => {
  const { client, methods, values } = mockClient();
  values.status = 0;
  const deposited = getAbiItem({ abi: kickbackAbi, name: "Deposited" });
  const log = {
    address,
    topics: [toEventSelector(deposited), encodeAbiParameters([{ type: "address" }], [guest])],
    data: encodeAbiParameters([{ type: "uint256" }], [10n]),
    transactionHash: row.tx,
    blockNumber: 9n,
    logIndex: 0,
  };
  methods.getLogs.mockImplementation(async (request) => (request.event?.name === "Deposited" ? [log] : []));
  methods.getTransaction.mockResolvedValue({ hash: row.tx, to: address, from: guest, value: 10n, blockNumber: 9n });
  methods.getTransactionReceipt.mockResolvedValue({
    status: "success",
    from: guest,
    to: address,
    blockNumber: 9n,
    logs: [log],
  });
  methods.getBlock.mockResolvedValue({ number: 9n, timestamp: 900n, transactions: [] });
  const result = await readGuests(
    client,
    cfg,
    `name,email,ticket_name,approval_status,eth_address,tx\nGuest,guest@example.com,deposit,approved,${guest},${row.tx}`,
  );
  expect(result.check?.newStakers.map((r) => r.wallet)).toEqual([guest]);
});

it("checks recipients, ownership, and displayed share immediately before sending", async () => {
  const { client, values } = mockClient();
  expect(validRecipient(guest, address)).toBe(guest);
  expect(() => validRecipient(zeroAddress, address)).toThrow();
  expect(() => validRecipient(address, address)).toThrow();
  await expect(
    prepareAction(client, scope, undefined, {
      name: "cancel",
      input: { confirmation: "CANCEL", expectedRegistered: 1 },
    }),
  ).rejects.toThrow("Connect");
  await expect(
    prepareAction(client, scope, guest, { name: "cancel", input: { confirmation: "CANCEL", expectedRegistered: 1 } }),
  ).rejects.toThrow("organiser");
  values.previewShare = 11n;
  await expect(
    prepareAction(client, scope, owner, { name: "postAttendance", input: { plan, confirmation: "POST" } }),
  ).rejects.toThrow("pool changed");
});

it("reads payout token metadata and a stamped single-guest removal without exposing challenge details", async () => {
  const { client, values } = mockClient();
  const { readPayoutActions } = await import("../operations/payout");
  Object.assign(values, { decimals: 6, symbol: "USDC" });
  const data = await readPayoutActions(client, scope, owner, { token: guest, guest, amount: 10n });
  expect(data.token).toEqual({ balance: 100n, decimals: 6, symbol: "USDC" });
  expect(data.removeGuestList?.items[0]?.wallet).toBe(guest);
  expect(data).not.toHaveProperty("challenges");
  expect((await readPayoutActions(client, scope, undefined, {})).release.lockedReason).toContain("Connect");
});

it("parses Kleros upload responses and verifies the gateway using a fake HTTP transport", async () => {
  const { uploadedPolicyPath, policyTransport } = await import("../operations/policy");
  const { policyURI } = await import("./fixtures");
  const cid = policyURI.slice(6);
  for (const answer of [
    cid,
    { cid },
    { path: `ipfs://${cid}` },
    { IpfsHash: cid },
    { Hash: cid },
    { cids: [cid] },
    { data: { cids: [cid] } },
    { data: { path: `https://gateway.example${policyURI}` } },
  ])
    expect(uploadedPolicyPath(answer)).toBe(policyURI);
  expect(() => uploadedPolicyPath({})).toThrow("pin service");
  const requests: { url: string; method?: string }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method });
    return new Response(init?.method === "POST" ? JSON.stringify({ cid }) : "policy", { status: 200 });
  };
  const transport = policyTransport(fetcher);
  await expect(transport.upload("policy")).resolves.toBe(policyURI);
  await expect(transport.fetch(policyURI)).resolves.toBe("policy");
  expect(requests[0]?.method).toBe("POST");
  expect(requests[0]?.url).toContain("operation=file");
  const failed = policyTransport(async () => new Response("", { status: 500 }));
  await expect(failed.upload("policy")).rejects.toThrow("Could not pin");
  await expect(failed.fetch(policyURI)).rejects.toThrow("Could not verify");
  await expect(failed.fetch("https://bad.example")).rejects.toThrow("Invalid");
});

it("refuses release, sweep, and cancellation when their confirmed figures changed", async () => {
  const { client, values } = mockClient();
  Object.assign(values, { phase: 1, challengeEndsAt: 1499n });
  await expect(
    prepareAction(client, scope, owner, {
      name: "releasePayouts",
      input: { confirmation: "PAY", expected: { pool: 20n, attendees: 1, share: 20n, heldBack: 0n } },
    }),
  ).rejects.toThrow("payout changed");
  values.phase = 2;
  await expect(
    prepareAction(client, scope, owner, { name: "sweep", input: { confirmation: "SWEEP", expectedSpare: 99n } }),
  ).rejects.toThrow("leftovers changed");
  values.phase = 0;
  await expect(
    prepareAction(client, scope, owner, { name: "cancel", input: { confirmation: "CANCEL", expectedRegistered: 2 } }),
  ).rejects.toThrow("count changed");
});
