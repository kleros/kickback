import { parseEther } from "viem";
import { describe, expect, it } from "vitest";

import { agoText, DEPOSIT_STATES, depositState, ethText, waitText } from "../depositState";
import { baseInput, FIXTURE, GALLERY_STATES, galleryInput, type GalleryState } from "../fixtures";

const EXPECTED: Record<GalleryState, { key: string; stage?: number; button: string; lines: string[] }> = {
  withdraw: {
    key: "withdraw",
    button: "Withdraw my deposit",
    lines: ["The list never came.", "Your deposit returns in full."],
  },
  claim: { key: "claim", button: "Claim", lines: ["0.01 ETH ready to claim."] },
  "paid-out": { key: "paid-out", button: "Paid out", lines: ["Paid out 0.013333333333333333 ETH", ""] },
  "not-attended": {
    key: "not-attended",
    button: "Not on the attendance list",
    lines: ["Contesting opens in a later release."],
  },
  returned: { key: "returned", button: "Returned", lines: ["0.005 ETH returned on 3 Nov"] },
  withdrawn: { key: "withdrawn", button: "Deposit withdrawn", lines: ["Your deposit was returned in full."] },
  checking: { key: "checking", button: "Checking deposits", lines: ["Reading the event's clock."] },
  rest: { key: "rest", button: "Connect wallet", lines: ["26 guests deposited"] },
  nowallet: {
    key: "nowallet",
    button: "Connect wallet",
    lines: ["No wallet in this browser.", "Connect by QR from your phone."],
  },
  connect: { key: "connect", button: "Approve in your wallet", lines: ["Your wallet is asking to connect."] },
  wrongnet: {
    key: "wrongnet",
    button: "Switch to Ethereum",
    lines: ["Your wallet is on Arbitrum One.", "This event is on Ethereum."],
  },
  addchain: { key: "addchain", button: "Add Ethereum to your wallet", lines: ["Ethereum is not in your wallet yet."] },
  ready: { key: "ready", button: "Deposit", lines: ["On Ethereum · 0.0412 ETH available"] },
  insufficient: {
    key: "insufficient",
    button: "Not enough ETH",
    lines: ["0.0062 ETH available", "0.0103 ETH needed with the fee."],
  },
  signing: { key: "signing", button: "Confirm in your wallet", lines: ["Your wallet is showing the deposit."] },
  pending1: {
    key: "pending",
    stage: 1,
    button: "Confirming",
    lines: ["Confirming on Ethereum · 14 s", "Usually under a minute."],
  },
  pending2: {
    key: "pending",
    stage: 2,
    button: "Confirming",
    lines: ["Still confirming · 2 min 14 s", "Keep this page open."],
  },
  pending3: {
    key: "pending",
    stage: 3,
    button: "Confirming",
    lines: ["Still confirming · 6 min 40 s", "Do not send it again."],
  },
  done: { key: "done", button: "Copy transaction link", lines: [] },
  failed: {
    key: "failed",
    button: "Try again",
    lines: ["Your 0.01 ETH stayed in your wallet.", "Only the network fee was spent."],
  },
  closed: { key: "closed", button: "Deposits closed", lines: ["The event has started."] },
  already: { key: "already", button: "Copy transaction link", lines: [] },
  earlier: {
    key: "earlier",
    button: "Confirming",
    lines: ["An earlier deposit is still confirming.", "Sent 3 min ago"],
  },
  dropped: {
    key: "dropped",
    button: "Deposit again",
    lines: ["The network dropped your transaction.", "Nothing left your wallet."],
  },
  replaced: {
    key: "replaced",
    button: "Deposit again",
    lines: ["Your wallet replaced the transaction.", "Check before sending again."],
  },
  refunded: {
    key: "refunded",
    button: "Refunded",
    lines: ["Your deposit was returned on 3 Nov.", "Ask the organiser before sending again."],
  },
  short: {
    key: "short",
    button: "Deposit",
    lines: ["0.005 ETH received, 0.005 ETH short.", "Refunded later. Send the full amount."],
  },
};

describe("depositState", () => {
  it.each(GALLERY_STATES)("%s", (state) => {
    const view = depositState(galleryInput(state));
    const want = EXPECTED[state];
    expect(view.key).toBe(want.key);
    expect(view.stage).toBe(want.stage);
    expect(view.button).toBe(want.button);
    expect(view.lines.map((l) => l.text)).toEqual(want.lines);
  });

  it("covers every state key", () => {
    const keys = new Set(GALLERY_STATES.map((s) => depositState(galleryInput(s)).key));
    expect([...keys].sort()).toEqual([...DEPOSIT_STATES].sort());
  });

  it("holds every status slot to two lines", () => {
    for (const s of GALLERY_STATES) expect(depositState(galleryInput(s)).lines.length).toBeLessThanOrEqual(2);
  });

  it("gives the done receipt the explorer link to copy, and the bare hash without an explorer", () => {
    const done = depositState(galleryInput("done"));
    expect(done.action).toBe("copy");
    expect(done.receipt).toMatchObject({ tx: FIXTURE.tx, txLink: `https://etherscan.io/tx/${FIXTURE.tx}` });
    const local = depositState({ ...galleryInput("done"), explorer: undefined });
    expect(local.receipt?.txLink).toBe(FIXTURE.tx);
    expect(local.receipt?.txUrl).toBeUndefined();
  });

  it("dates an earlier deposit on the receipt", () => {
    expect(depositState(galleryInput("already")).receipt?.when).toBe("2 Nov");
  });

  it("shows a receipt to a guest who deposited even after deposits closed", () => {
    const input = galleryInput("already");
    expect(depositState({ ...input, chainNow: input.eventStart + 10 }).key).toBe("already");
  });

  it("closes deposits at eventStart on the chain's clock, and when the phase moves on", () => {
    const b = baseInput();
    expect(depositState({ ...b, chainNow: b.eventStart - 1 }).key).toBe("ready");
    expect(depositState({ ...b, chainNow: b.eventStart }).key).toBe("closed");
    expect(depositState({ ...b, phase: 3 }).lines[0]!.text).toBe("The event was cancelled.");
    expect(depositState({ ...b, phase: 1 }).lines[0]!.text).toBe("The attendance list is out.");
  });

  it("does not enable deposits before chain time is known", () => {
    expect(depositState({ ...baseInput(), chainNow: undefined })).toMatchObject({
      key: "checking",
      action: "none",
      disabled: true,
    });
  });

  it("asks for the QR code rather than approval when there is no injected wallet", () => {
    const input = galleryInput("connect");
    expect(depositState({ ...input, wallet: { ...input.wallet, hasProvider: false } }).key).toBe("nowallet");
  });

  it("names an unknown network plainly", () => {
    const input = galleryInput("wrongnet");
    const view = depositState({ ...input, wallet: { ...input.wallet, chainId: 999 } });
    expect(view.lines[0]!.text).toBe("Your wallet is on another network.");
  });

  it("returns to ready with the reason and a shake when the wallet declines", () => {
    const view = depositState({
      ...baseInput(),
      send: { account: FIXTURE.wallet, status: "error", errorKind: "wallet" },
    });
    expect(view.key).toBe("ready");
    expect(view.shake).toBe(true);
    expect(view.lines[0]).toMatchObject({ text: "Declined in your wallet. Nothing was sent.", tone: "err" });
  });

  it("says nothing was sent when the dry run refuses", () => {
    const view = depositState({
      ...baseInput(),
      send: { account: FIXTURE.wallet, status: "error", errorKind: "refused" },
    });
    expect(view.key).toBe("failed");
    expect(view.lines[1]!.text).toBe("Nothing was sent.");
  });

  it("treats an unconfirmed send as stuck pending", () => {
    const view = depositState({
      ...baseInput(),
      send: { account: FIXTURE.wallet, status: "error", errorKind: "unconfirmed", hash: FIXTURE.tx },
    });
    expect(view).toMatchObject({ key: "pending", stage: 3 });
  });

  it("reads a mined record as deposited before the logs catch up", () => {
    const view = depositState({
      ...baseInput(),
      sent: {
        data: "0xd0e30db0",
        value: baseInput().amount.toString(),
        outcome: "mined",
        hash: FIXTURE.tx,
        at: FIXTURE.nowMs,
      },
    });
    expect(view.key).toBe("already");
  });

  it("ignores a record older than the send under way", () => {
    const view = depositState({
      ...baseInput(),
      send: { account: FIXTURE.wallet, status: "pending", startedAt: FIXTURE.nowMs },
      sent: {
        data: "0xd0e30db0",
        value: baseInput().amount.toString(),
        outcome: "pending",
        hash: FIXTURE.tx,
        at: FIXTURE.nowMs - 1000,
      },
    });
    expect(view.key).toBe("signing");
  });

  it("counts the fee into what is needed, and only the deposit when the fee is unknown", () => {
    const b = baseInput();
    expect(depositState({ ...b, balance: parseEther("0.0101") }).key).toBe("insufficient");
    expect(depositState({ ...b, balance: parseEther("0.0101"), fee: undefined }).key).toBe("ready");
  });

  it("words guest counts", () => {
    const rest = galleryInput("rest");
    expect(depositState({ ...rest, guests: 0 }).lines[0]!.text).toBe("Be the first to deposit");
    expect(depositState({ ...rest, guests: 1 }).lines[0]!.text).toBe("1 guest deposited");
  });
});

describe("text helpers", () => {
  it("formats amounts and waits", () => {
    expect(ethText(parseEther("0.0125"))).toBe("0.0125");
    expect(waitText(14_900)).toBe("14 s");
    expect(waitText(134_000)).toBe("2 min 14 s");
    expect(agoText(30_000)).toBe("under a minute");
    expect(agoText(3 * 60_000)).toBe("3 min");
  });
});

it("does not call an organiser transaction a deposit", () => {
  const input = baseInput();
  expect(depositState({ ...input, sent: { hash: FIXTURE.tx, outcome: "mined", at: input.wallNow } }).key).toBe("ready");
});

it("holds the Deposit button while a mined record without call data waits for the history", () => {
  const input = baseInput();
  const view = depositState({
    ...input,
    history: undefined,
    sent: { hash: FIXTURE.tx, outcome: "mined", at: input.wallNow },
  });
  expect(view.key).toBe("earlier");
  expect(view.action).toBe("none");
  expect(view.disabled).toBe(true);
});

it("does not reuse A's successful deposit for B", () => {
  const input = galleryInput("done");
  expect(
    depositState({ ...input, wallet: { ...input.wallet, address: "0x9999999999999999999999999999999999999999" } }).key,
  ).toBe("ready");
});

it("keeps legacy pending records blocking without claiming they are deposits", () => {
  const input = baseInput();
  const view = depositState({ ...input, sent: { hash: FIXTURE.tx, outcome: "pending", at: input.wallNow } });
  expect(view.action).toBe("none");
  expect(view.lines[0]?.text).toBe("An earlier transaction is still confirming.");
});

it("keeps a registered surplus payer's receipt with a secondary return line", () => {
  const input = galleryInput("already");
  const view = depositState({
    ...input,
    guest: { status: 1, owed: 0n, attended: false, payoutShare: 0n },
    history: { ...input.history!, deposited: input.amount, returned: { amount: parseEther("0.005") } },
  });
  expect(view.key).toBe("already");
  expect(view.receipt?.tx).toBe(FIXTURE.tx);
  expect(view.lines).toContainEqual({ text: "0.005 ETH returned" });
});
