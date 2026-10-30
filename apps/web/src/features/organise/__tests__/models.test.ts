import { ISSUE_CODES, TX_GAS_CAP, ipfsCidV0 } from "@kickback/core";
import { zeroAddress } from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  address,
  checked,
  event,
  form,
  guest,
  guestCheck,
  owner,
  plan,
  policyURI,
  row,
  scope,
  stamp,
} from "./fixtures";
import { attendanceGates, attendanceModel } from "../model/attendance";
import {
  createConfig,
  createDeployment,
  jurorPreview,
  pinGenericPolicy,
  readDeployments,
  saveDeployment,
} from "../model/create";
import { batchLists, batches, guestRows, ISSUE_TEXT, snapshotRefusal } from "../model/guests";
import { dustBound, payoutFigures, payoutGates, releasePlan } from "../model/payout";
import { eventDeadline, overviewModel, unreadRelease } from "../model/phase";
import { GENERIC_POLICY_TEXT } from "../model/policy";
import { configKey, gate, organiserKey, requireEnabled } from "../model/shared";

const facts = {
  deposits: 2,
  registered: 1,
  attendees: 1,
  openChallenges: 0,
  challengeEndsAt: 2000,
  spare: 1n,
  release: gate("Wait for the challenge window."),
};

describe("overview", () => {
  it.each([
    [0, 999, 2, false, "Deposits open"],
    [0, 999, 1, false, "Waiting for the event"],
    [0, 1000, 1, false, "Attendance due"],
    [0, 1000000, 1, false, "Attendance due"],
    [0, 1000001, 1, false, "Past the deadline"],
    [1, 2000, 1, false, "List posted"],
    [1, 2001, 1, true, "Payouts ready"],
    [2, 2001, 1, true, "Paid out"],
    [3, 1000001, 1, false, "Cancelled"],
  ])("maps phase %s at %s", (phase, now, deposits, ready, expected) => {
    const model = overviewModel({ ...event, phase }, now, {
      ...facts,
      deposits,
      release: gate(ready ? null : "Wait."),
    });
    expect(model.phase).toBe(expected);
    expect(model.counts.openChallenges).toBe(0);
    expect(model).not.toHaveProperty("challenges");
    expect(model.nextStep.title).toBeTruthy();
  });
  it("uses the event clock and never the computer clock", () => {
    expect(eventDeadline(0, { offset: 330, zone: "IST" }).text).toBe("1970-01-01 05:30 IST");
    expect(overviewModel(event, 1000, facts).clock.zone).toBe("UTC");
    expect(unreadRelease().enabled).toBe(false);
    expect(() => overviewModel({ ...event, phase: 8 }, 0, facts)).toThrow("Unknown");
    expect(overviewModel({ ...event, phase: 2 }, 0, { ...facts, spare: 0n }).nextStep.actionRoute).toBeNull();
    expect(overviewModel({ ...event, phase: 3 }, 0, facts).nextStep.detail).toContain("unregistered");
  });
});

describe("guests", () => {
  it.each(ISSUE_CODES)("translates %s into plain words and a next action", (code) => {
    expect(ISSUE_TEXT[code]).toContain(";");
    expect(ISSUE_TEXT[code]).not.toContain(code);
  });
  it("preserves ticks on refresh but removes ineligible ticks", () => {
    const [first] = guestRows([row]);
    expect(first?.name).toBe("");
    expect(guestRows([row], null, { [first!.id]: "refund" })[0]?.tick).toBe("refund");
    expect(guestRows([{ ...row, canRefund: false }], null, { [first!.id]: "refund" })[0]?.tick).toBeNull();
    expect(guestRows([{ ...row, code: "unknown", canRegister: false }])[0]?.status).toContain("check again");
  });
  it("auto-ticks approved and declined checks, including copied late-refund rows", () => {
    expect(guestRows([row], guestCheck())[0]?.tick).toBe("register");
    const late = { ...checked, code: "OUTSIDE_WINDOW" as const, decision: "declined" as const };
    const check = guestCheck({ verified: [], issues: [late], newStakers: [], refunds: [{ ...late }] });
    expect(guestRows([row], check)[0]?.tick).toBe("refund");
    expect(guestRows([row], guestCheck({ listOpen: false }))[0]?.canRegister.enabled).toBe(false);
  });
  it("keeps issue precedence, unmatched deposits, and stable IDs across reordered rows", () => {
    const check = guestCheck({ issues: [{ ...checked, code: "RETURNED_EARLIER" }], newStakers: [] });
    expect(guestRows([row], check)).toHaveLength(1);
    expect(guestRows([row], check)[0]?.status).toBe(ISSUE_TEXT.RETURNED_EARLIER);
    expect(guestRows([{ ...row, from: owner }], check)).toHaveLength(2);
    const a = guestRows([], guestCheck())[0]!;
    expect(guestRows([], guestCheck({ verified: [{ ...checked }] }), { [a.id]: null })[0]?.tick).toBeNull();
  });
  it("splits into hundreds without accepting duplicates or zero wallets", () => {
    const wallets = Array.from({ length: 201 }, (_, n) => `0x${(n + 1).toString(16).padStart(40, "0")}`);
    expect(batches(wallets).map((b) => b.length)).toEqual([100, 100, 1]);
    expect(batches([])).toEqual([]);
    expect(() => batches([guest, guest])).toThrow();
    expect(() => batches([zeroAddress])).toThrow();
    expect(() => batches(["bad"])).toThrow();
  });
  it("refuses changed money, status, event, network, and invalid snapshot blocks", () => {
    const current = { contract: address, chainId: 1, deposit: 10n, block: 11, relevantLogs: 0, statusChanged: false };
    expect(snapshotRefusal(stamp(), current).enabled).toBe(true);
    for (const patch of [
      { contract: guest },
      { chainId: 2 },
      { deposit: 11n },
      { block: 9 },
      { relevantLogs: 1 },
      { statusChanged: true },
    ])
      expect(snapshotRefusal(stamp(), { ...current, ...patch }).enabled).toBe(false);
    expect(snapshotRefusal({ ...stamp(), block: NaN }, current).enabled).toBe(false);
  });
});

describe("attendance", () => {
  it("gates the exact start, deadline, confirmation, and add window boundaries", () => {
    expect(attendanceGates(event, 999, 2000, plan, "POST").post.lockedReason).toContain("starts");
    expect(attendanceGates(event, 1000, 2000, plan, "POST").post.enabled).toBe(true);
    expect(attendanceGates(event, 1000000, 2000, plan, "POST").post.enabled).toBe(true);
    expect(attendanceGates(event, 1000001, 2000, plan, "POST").post.enabled).toBe(false);
    expect(attendanceGates(event, 1000, 2000, plan).post.lockedReason).toContain("POST");
    expect(attendanceGates(event, 1000, 2000, { ...plan, unknown: [owner] }, "POST").post.lockedReason).toContain(
      "NOSHOW",
    );
    expect(attendanceGates(event, 1000, 2000, { ...plan, unknown: [owner] }, "POST", "NOSHOW").post.enabled).toBe(true);
    expect(attendanceGates({ ...event, phase: 1 }, 2000, 2000).add.enabled).toBe(true);
    expect(attendanceGates({ ...event, phase: 1 }, 2001, 2000).add.enabled).toBe(false);
    expect(attendanceGates(event, 1000, 2000, plan, "POST", "", false).post.enabled).toBe(false);
    expect(attendanceGates(event, 1000, 2000).post.enabled).toBe(false);
    expect(attendanceGates(event, 1000, 2000, { ...plan, attendees: [] }, "POST").post.enabled).toBe(false);
  });
  it("exports the plan and rejects a changed previewShare", () => {
    expect(attendanceModel(plan, 10n).downloads.csv).toContain("wallet");
    expect(attendanceModel(plan, 10n).downloads.summary).toBe("One attendee");
    expect(JSON.parse(attendanceModel(plan, 10n).downloads.plan).attendees).toEqual([guest]);
    expect(() => attendanceModel(plan, 11n)).toThrow("share changed");
  });
});

describe("payout", () => {
  const base = { event, now: 1000, isOwner: true, release: gate(), spare: 2n, attendees: 2n, matchedCases: 1n };
  it("pre-settles only expired unmatched challenges when the margin cannot fit", () => {
    const challenges = [
      { wallet: guest, state: 1, matchEndsAt: 10, matched: false },
      { wallet: owner, state: 2, matchEndsAt: 0, matched: true },
    ];
    expect(releasePlan(challenges, 10, TX_GAS_CAP).wallets).toEqual([]);
    expect(releasePlan(challenges, 11, TX_GAS_CAP).wallets).toEqual([guest]);
    expect(releasePlan(challenges, 11, 1n).wallets).toEqual([]);
    expect(releasePlan(challenges, 11, null).wallets).toEqual([guest]);
  });
  it("protects non-dust money and reserved funds and gates all actions", () => {
    expect(dustBound(2n, 1n)).toBe(5n);
    expect(() => dustBound(-1n, 1n)).toThrow();
    expect(payoutGates(base).release.enabled).toBe(false);
    expect(payoutGates({ ...base, confirmation: "PAY" }).release.enabled).toBe(true);
    expect(payoutGates(base).cancel.enabled).toBe(false);
    expect(payoutGates({ ...base, confirmation: "CANCEL" }).cancel.enabled).toBe(true);
    expect(payoutGates({ ...base, confirmation: "CANCEL", now: 1000001 }).cancel.enabled).toBe(false);
    expect(payoutGates(base).sweep.enabled).toBe(false);
    const finalized = { ...base, event: { ...event, phase: 2 } };
    expect(payoutGates(finalized).sweep.enabled).toBe(true);
    expect(payoutGates({ ...finalized, spare: 6n }).sweep.enabled).toBe(false);
    expect(payoutGates({ ...finalized, spare: 6n, confirmation: "SWEEP" }).sweep.enabled).toBe(true);
    expect(payoutGates({ ...finalized, spare: 0n }).sweep.enabled).toBe(false);
    expect(payoutGates({ ...base, amount: 3n }).refund.enabled).toBe(false);
    expect(payoutGates({ ...base, amount: 2n }).refund.enabled).toBe(true);
    expect(payoutGates({ ...base, guestStatus: 1 }).removeGuest.enabled).toBe(true);
    expect(payoutGates({ ...base, amount: 2n, tokenBalance: 2n }).returnToken.enabled).toBe(true);
    expect(payoutGates({ ...base, amount: 3n, tokenBalance: 2n }).returnToken.enabled).toBe(false);
    expect(payoutGates({ ...base, isOwner: false, amount: 2n, tokenBalance: 2n }).returnToken.enabled).toBe(false);
  });
  it("shows the prospective share with expired unmatched attendees and held shares", () => {
    const data = {
      phase: 1,
      deposit: 10n,
      registered: 4,
      attendees: 2,
      challenges: [
        { wallet: guest, state: 1, matchEndsAt: 0, matched: false },
        { wallet: owner, state: 2, matchEndsAt: 0, matched: true },
      ],
      payoutShare: 12n,
      heldBack: 12n,
      now: 1,
    };
    expect(payoutFigures(data)).toEqual({ pool: 40n, attendees: 3, share: 10n, heldBack: 10n });
    expect(payoutFigures({ ...data, phase: 0 }).share).toBeNull();
    expect(payoutFigures({ ...data, phase: 2 }).share).toBe(12n);
  });
});

describe("creation", () => {
  it("validates the schema and creates matching constructor arguments and a wallet-free juror preview", () => {
    const cfg = createConfig(form, { chainId: 1 });
    expect(cfg.eventWhen).toContain("IST");
    expect(cfg.claimDeadlineTs! - cfg.eventStartTs!).toBe(14 * 86400);
    expect(createDeployment(form, { chainId: 1 }, owner, policyURI, 0).args[1]).toBe("Dinner");
    expect(jurorPreview(form, { chainId: 1 }, policyURI)).toContain("Dinner");
    expect(() => createDeployment(form, { chainId: 1 }, owner, policyURI, cfg.eventStartTs!)).toThrow("future");
  });
  it.each([
    { settleDays: 6 },
    { settleDays: 366 },
    { settleDays: 7.5 },
    { deposit: "0" },
    { deposit: "1.1" },
    { deposit: "1e-2" },
    { title: "" },
    { registrationLink: "http://example.com" },
    { zoneName: "UTC" },
    { end: form.start },
    { start: "2027-02-30T10:00" },
    { timezoneOffset: "+25:00" },
  ])("rejects invalid fields %j", (patch) => {
    expect(() => createConfig({ ...form, ...patch }, { chainId: 1 })).toThrow();
  });
  it("checks policy upload and gateway bytes against the canonical CID", async () => {
    const uri = `/ipfs/${ipfsCidV0(GENERIC_POLICY_TEXT)}`;
    const transport = { upload: vi.fn().mockResolvedValue(uri), fetch: vi.fn().mockResolvedValue(GENERIC_POLICY_TEXT) };
    await expect(pinGenericPolicy(transport)).resolves.toBe(uri);
    expect(transport.upload).toHaveBeenCalledWith(GENERIC_POLICY_TEXT);
    transport.fetch.mockResolvedValue("tampered");
    await expect(pinGenericPolicy(transport)).rejects.toThrow("did not match");
    transport.upload.mockResolvedValue("/ipfs/wrong");
    await expect(pinGenericPolicy(transport)).rejects.toThrow();
  });
  it("tolerates corrupt, unavailable or full localStorage and deduplicates deployments", () => {
    const store = { getItem: vi.fn().mockReturnValue("bad"), setItem: vi.fn() };
    expect(readDeployments(store)).toEqual([]);
    const deployment = { address, chainId: 1, block: 1, name: "Dinner" };
    store.getItem.mockReturnValue(JSON.stringify([deployment, { address: "bad" }]));
    expect(readDeployments(store)).toEqual([deployment]);
    expect(saveDeployment(deployment, store)).toBe(true);
    expect(JSON.parse(store.setItem.mock.calls[0]![1])).toHaveLength(1);
    store.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    expect(saveDeployment(deployment, store)).toBe(false);
    store.getItem.mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readDeployments(store)).toEqual([]);
    expect(readDeployments({ getItem: () => "{}", setItem: () => {} })).toEqual([]);
    expect(readDeployments()).toEqual([]);
  });
});

it("provides safe gates and bigint-free query identities", () => {
  expect(() => requireEnabled(gate())).not.toThrow();
  expect(() => requireEnabled(gate("Stop"))).toThrow("Stop");
  expect(organiserKey(scope)).toEqual(["organise", 1, address]);
  expect(configKey({ amount: 1n })).toBe('{"amount":"1"}');
});

it("preserves the snapshot when splitting stamped batches", () => {
  const list = stamp();
  expect(batchLists(list)).toEqual([list]);
  expect(batchLists({ ...list, items: [] })).toEqual([]);
});

it("shows deposit amounts and permits a manual refund of a verified approved payer", () => {
  const rows = guestRows([row], guestCheck());
  expect(rows[0]?.amount).toBe(10n);
  expect(rows[0]?.canRefund.enabled).toBe(true);
  expect(guestRows([row], guestCheck(), { [rows[0]!.id]: "refund" })[0]?.tick).toBe("refund");
});

it("keeps refund eligibility when query structural sharing separates equivalent rows", async () => {
  const { replaceEqualDeep } = await import("@tanstack/react-query");
  const first = { ...checked, wallet: owner, email: "first@example.com" };
  const before = guestCheck({ verified: [first, checked], newStakers: [first, checked] });
  const after = guestCheck({
    verified: [{ ...first, onchain: "registered" }, { ...checked }],
    newStakers: [{ ...checked }],
  });
  const cached = replaceEqualDeep(before, after);
  expect(cached.verified[1]).not.toBe(cached.newStakers[0]);
  expect(guestRows([row], cached).find((r) => r.wallet === guest)?.canRefund.enabled).toBe(true);
});

it("gives a declined verified payer a refund verdict", () => {
  const declined = { ...checked, approval: "declined", decision: "declined" as const };
  const [result] = guestRows([row], guestCheck({ verified: [declined], newStakers: [], refunds: [declined] }));
  expect(result?.status).toBe("Declined on Luma; refund the deposit");
  expect(result?.canRegister.enabled).toBe(false);
  expect(result?.canRefund.enabled).toBe(true);
});

it("offers only the held short payment for return", () => {
  const [result] = guestRows([
    { ...row, amount: 5n, held: 3n, code: "AMOUNT_TOO_LOW", canRegister: false, canRefund: false },
  ]);
  expect(result?.returnAmount).toBe(3n);
  expect(guestRows([{ ...row, held: 0n, code: "AMOUNT_TOO_LOW" }])[0]?.returnAmount).toBeNull();
});
