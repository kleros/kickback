import { parseEther } from "viem";
import { describe, expect, it } from "vitest";

import { depositState, type DepositInput } from "../depositState";
import { baseInput, FIXTURE, galleryInput } from "../fixtures";

describe("depositState", () => {
  it("does not offer a deposit while the wallet's booking is still unknown", () => {
    const view = depositState({ ...galleryInput("ready"), guestUnknown: true });
    expect(view.key).toBe("checking");
    expect(view.action).toBe("none");
  });

  it("offers the deposit once the booking is known", () => {
    expect(depositState({ ...galleryInput("ready"), guestUnknown: false }).action).toBe("deposit");
  });

  it("an unknown booking does not matter to a visitor without a wallet", () => {
    const b = baseInput();
    const visitor = { ...b, wallet: { ...b.wallet, status: "disconnected" as const, address: undefined } };
    expect(depositState({ ...visitor, guestUnknown: true }).key).not.toBe("checking");
  });

  it("a guest whose case is still with Kleros after the list is final sees the case, not a lost deposit", () => {
    const d = galleryInput("disputed");
    const view = depositState({ ...d, phase: 2 });
    expect(view.key).toBe("disputed");
    // evidence goes to the Dispute Resolver's case page
    expect(JSON.stringify(view)).toContain("resolve.kleros.io/cases/");
    expect(JSON.stringify(view)).not.toContain("went to the guests");
  });

  it("falls back to the court's case page when there is no resolver link", () => {
    const d = galleryInput("disputed");
    const view = depositState({
      ...d,
      evidenceUrl: undefined,
      caseUrl: (id) => `https://court.kleros.io/cases/${id}`,
    });
    expect(JSON.stringify(view)).toContain("court.kleros.io/cases/1712");
  });

  it("asks a visitor without a wallet to connect on the closed and full cards", () => {
    expect(depositState(galleryInput("closed")).action).toBe("connect");
    expect(depositState(galleryInput("full-visitor")).action).toBe("connect");
  });

  it("keeps checking, rather than showing the closed card, while a wallet's booking is unknown after the end", () => {
    const b = baseInput();
    const view = depositState({ ...b, chainNow: b.eventEnd + 60, guestUnknown: true });
    expect(view.key).toBe("checking");
    expect(view.action).toBe("none");
  });

  it("tells a wallet failure apart from the guest's own cancel", () => {
    const b = galleryInput("ready");
    const notice = (errorMessage: string) =>
      depositState({ ...b, send: { account: b.wallet.address, status: "error", errorKind: "wallet", errorMessage } })
        .lines[0]!.text;
    expect(notice("Cancelled in your wallet. Nothing was sent.")).toBe("Cancelled in your wallet. Nothing was sent.");
    expect(notice("This wallet does not have enough ETH for this (amount plus network fee).")).toBe(
      "Not enough ETH. Nothing was sent.",
    );
    expect(notice("Internal JSON-RPC error.")).toBe("Your wallet hit an error. Nothing was sent.");
  });

  it("keeps the short line for a refused account switch on the card", () => {
    const b = galleryInput("ready");
    const view = depositState({
      ...b,
      send: { account: b.wallet.address, status: "error", errorKind: "account-changed", errorMessage: "long" },
    });
    expect(view.lines[0]!.text).toBe("Wallet switched accounts. Try again.");
  });

  it("lets an attendee release payouts once nothing blocks them, and waits while a challenge does", () => {
    const view = depositState(galleryInput("release"));
    expect(view.key).toBe("release");
    expect(view.action).toBe("release");
    const blocked = depositState({ ...galleryInput("release"), release: { expired: [], blocked: true } });
    expect(blocked.action).toBe("none");
    expect(blocked.button).toBe("Waiting for payouts");
  });

  it("offers to settle a case Kleros has ruled on, and only a read-only card when it ruled against the guest", () => {
    const won = depositState(galleryInput("ruled"));
    expect(won.action).toBe("resolve");
    expect(won.button).toBe("Join the list");
    const g = galleryInput("ruled");
    const lost = depositState({ ...g, guest: { ...g.guest!, challenge: { ...g.guest!.challenge, ruling: 2 } } });
    expect(lost.action).toBe("none");
    const unruled = depositState({
      ...g,
      guest: { ...g.guest!, challenge: { ...g.guest!.challenge, isRuled: false } },
    });
    expect(unruled.label).toBe("With Kleros");
  });

  it("shows the money a ruled case pays back, and short one-line errors for the money actions", () => {
    const g = galleryInput("ruled");
    const c = { ...g.guest!.challenge, deposit: parseEther("0.03"), arbitrationPaid: parseEther("0.03") };
    expect(depositState({ ...g, guest: { ...g.guest!, challenge: c } }).amount).toBe("0.03");
    const refused = depositState({ ...g, guest: { ...g.guest!, challenge: { ...c, ruling: 0 } } });
    expect(refused.amount).toBe("0.015");
    expect(refused.lines[1]!.text).toBe("Settle the ruling to end the challenge.");
    const busy = depositState({
      ...g,
      moneySend: { account: g.wallet.address, action: "resolve", status: "error", errorKind: "busy", error: "long" },
    });
    expect(busy.lines[0]!.text).toBe("Wait for the other action to finish.");
  });

  it("says when the network switch is open in the wallet or was declined, on one line", () => {
    const g = galleryInput("ready");
    const off = { ...g.wallet, chainId: 10 };
    const open = depositState({ ...g, wallet: { ...off, switching: true } });
    expect(open.button).toBe("Confirm in your wallet");
    expect(open.glyph).toBe("ring");
    const declined = depositState({ ...g, wallet: { ...off, switchFailed: "declined" } });
    expect(declined.lines.map((l) => l.text)).toEqual([
      "You declined the switch. Try again.",
      "This event is on Ethereum.",
    ]);
  });

  it("says a signed claim is confirming instead of asking to confirm again", () => {
    const b = galleryInput("claim");
    const moneySend = { account: b.wallet.address, action: "claim" as const, status: "pending" as const };
    expect(depositState({ ...b, moneySend }).button).toBe("Confirm in your wallet");
    const signed = depositState({ ...b, moneySend: { ...moneySend, hash: `0x${"1".repeat(64)}` as const } });
    expect(signed.button).toBe("Confirming");
    expect(signed.lines[0]!.text).toBe("Confirming on Ethereum.");
  });

  it("counts the network fee before offering a challenge", () => {
    const c = galleryInput("challenge");
    const view = depositState({ ...c, balance: c.challengeDeposit, challengeFee: 10n ** 14n });
    expect(view.button).toBe("Not enough ETH");
    expect(view.disabled).toBe(true);
  });

  it("does not date a deposit with today while its block time loads", () => {
    const b = galleryInput("ready");
    const view = depositState({
      ...b,
      guest: {
        status: 1,
        attended: false,
        claimable: 0n,
        claimableEth: 0n,
        sharePaid: 0n,
        challenge: { state: 0, matchEndsAt: 0, arbitratorDisputeID: 0n },
      },
      history: { txHash: `0x${"2".repeat(64)}` },
    });
    expect(view.receipt?.when).toBeUndefined();
  });
});

describe("challenge window while the chain's time loads", () => {
  it("never says the window has closed before the time is known", () => {
    const input = { ...galleryInput("challenge"), chainNow: undefined };
    const view = depositState(input);
    expect(view.key).toBe("checking");
    expect(view.key).not.toBe("not-attended");
  });

  it("offers the challenge once the time is known", () => {
    expect(depositState(galleryInput("challenge")).key).toBe("challenge");
  });

  it("shows a turned-away guest the refund transaction, and keeps the card's two lines", () => {
    const view = depositState(galleryInput("refunded"));
    expect(view.key).toBe("refunded");
    expect(view.lines).toHaveLength(2);
    // both money movements: the deposit, then the refund
    expect(view.lines[1]?.link?.label).toBe("Deposit");
    expect(view.lines[1]?.link2?.label).toBe("Refund");
    expect(view.foot).toBe("This wallet cannot deposit again.");
    // without the deposit's transaction, the refund link alone
    const noDeposit = depositState({ ...galleryInput("refunded"), history: { paidTx: FIXTURE.tx } });
    expect(noDeposit.lines[1]?.link?.label).toBe("Refund transaction");
  });

  it("gives a wallet with no deposit the reason deposits are closed, first", () => {
    const b = baseInput();
    const cancelled = depositState({
      ...b,
      phase: 3,
      guest: { ...galleryInput("claim").guest!, status: 0, claimable: 0n },
    });
    expect(cancelled.lines[0]?.text).toBe("The event was cancelled.");
    expect(cancelled.lines[1]?.text).toContain("No deposit from");
    const ended = depositState({
      ...b,
      chainNow: b.eventEnd + 60,
      guest: { ...galleryInput("claim").guest!, status: 0, claimable: 0n },
    });
    expect(ended.lines[0]?.text).toBe("The event has ended.");
  });

  it("shows the deposit link as soon as the browser's deposit record is mined, before the logs catch up", () => {
    const b = baseInput();
    const guest = { ...galleryInput("claim").guest!, status: 1, attended: false, claimable: 0n, phase: 0 };
    const view = depositState({
      ...b,
      guest,
      history: {},
      sent: { data: "0xd0e30db0", value: b.amount.toString(), outcome: "mined", hash: FIXTURE.tx, at: FIXTURE.nowMs },
    });
    expect(view.button).toBe("Copy deposit link");
    expect(view.receipt?.tx).toBe(FIXTURE.tx);
  });

  it("keeps the ≈ on a share that does not divide evenly", () => {
    const b = galleryInput("claim");
    const view = depositState({ ...b, guest: { ...b.guest!, claimable: 16666666666666666n } });
    expect(view.amount).toBe("≈0.016667");
  });

  it("says 'Joining the list' while an unanswered challenge's join is confirming", () => {
    const b = galleryInput("resolve");
    const pending = (joins: boolean) =>
      depositState({
        ...b,
        moneySend: { account: b.wallet.address, action: "resolve", status: "pending", joins },
      }).label;
    expect(pending(true)).toBe("Joining the list");
    expect(pending(false)).toBe("Settling the ruling");
  });

  it("during Kleros's appeal window, says how the jurors ruled and until when it can be appealed", () => {
    const d = galleryInput("disputed");
    const now = d.chainNow!;
    const appeal = (ruling: number, loserEnd: number, end: number) =>
      depositState({
        ...d,
        guest: {
          ...d.guest!,
          challenge: {
            ...d.guest!.challenge,
            appeal: { ruling, start: now - 60, end, loserEnd, costAttended: 10n ** 16n, costAbsent: 2n * 10n ** 16n },
          },
        },
      });
    const lost = appeal(2, now + 600, now + 1200);
    expect(lost.lines[0]?.text).toBe("Jurors ruled you did not come.");
    expect(lost.lines[1]?.text).toContain("Appeal by");
    expect(lost.button).toBe("Appeal period");
    const won = appeal(1, now + 600, now + 1200);
    expect(won.lines[0]?.text).toBe("Jurors ruled you came.");
    expect(won.lines[1]?.text).toContain("The organiser can appeal until");
    const over = appeal(1, now - 600, now - 60);
    expect(over.lines[1]?.text).toBe("Appeals have closed. The ruling becomes final soon.");
    expect(over.button).toBe("Waiting for the final ruling");
  });
});

describe("depositState: round 2 fixes", () => {
  const guest = (over: Record<string, unknown> = {}) => ({
    status: 1,
    attended: false,
    claimable: 0n,
    claimableEth: 0n,
    sharePaid: 0n,
    challenge: { state: 0, matchEndsAt: 0, arbitratorDisputeID: 0n },
    ...over,
  });
  const text = (v: ReturnType<typeof depositState>) => v.lines.map((l) => `${l.text} ${l.link?.label ?? ""}`).join(" ");

  it("the organiser's own wallet with no deposit is told it is their event, with no deposit button", () => {
    const view = depositState({
      ...baseInput(),
      organiser: true,
      organiserHref: "/organise/0xabc",
      guest: guest({ status: 0 }),
    });
    expect(view.key).toBe("organiser");
    expect(view.action).toBe("none");
    expect(view.foot).toBeNull();
    expect(view.lines[0]?.text).toBe("You organise this event. Guests deposit here.");
    expect(view.lines[1]?.link?.href).toBe("/organise/0xabc");
    // after the end too: no "No deposit from 0x…"
    const after = depositState({ ...baseInput(), organiser: true, chainNow: baseInput().eventEnd + 60 });
    expect(after.key).toBe("organiser");
  });

  it("the organiser's card follows the event's step", () => {
    const b = baseInput();
    const end = b.eventEnd;
    const line = (over: Partial<DepositInput>) =>
      depositState({ ...b, organiser: true, stakerCount: 3, claimDeadline: end + 7 * 86_400, ...over }).lines[0]?.text;
    expect(line({ chainNow: end + 60 })).toBe("Deposits are closed. Confirm who came on the organiser page.");
    expect(line({ chainNow: end + 60, attendeeCount: 2 })).toBe(
      "Deposits are closed. Close the list on the organiser page.",
    );
    expect(line({ chainNow: end + 60, stakerCount: 0 })).toBe(
      "The event ended with no deposits: there is nothing to confirm.",
    );
    expect(line({ chainNow: end + 8 * 86_400 })).toBe(
      "Attendance was not confirmed in time. Guests can withdraw their full deposits.",
    );
    const listed = { phase: 1, challengeEndsAt: end + 86_400, chainNow: end + 3600 };
    expect(line({ ...listed, waitingChallenges: 1 })).toBe(
      "A challenge is waiting for your answer on the organiser page.",
    );
    expect(line({ ...listed, timeText: () => "Wed 4 Nov, 18:00" })).toBe("Challenges are open until Wed 4 Nov, 18:00.");
    const after = { ...listed, chainNow: end + 2 * 86_400 };
    expect(line({ ...after, release: { expired: [], blocked: true } })).toBe(
      "A challenge is still waiting for your answer on the organiser page.",
    );
    expect(line({ ...after, release: { expired: [], blocked: false } })).toBe(
      "Challenges have closed. Release payouts on the organiser page.",
    );
    expect(line({ phase: 2, chainNow: end + 3 * 86_400 })).toBe(
      "Payouts are released. Track them on the organiser page.",
    );
    expect(line({ phase: 3 })).toBe("You cancelled this event. Guests can withdraw their full deposits.");
  });

  it("an organiser who deposited keeps the guest views for their own money", () => {
    const b = baseInput();
    const view = depositState({ ...b, organiser: true, phase: 2, guest: guest({ attended: true, claimable: 1n }) });
    expect(view.key).toBe("claim");
    expect(depositState({ ...galleryInput("withdraw"), organiser: true }).key).toBe("withdraw");
  });

  it("says Both spots for a capacity of two", () => {
    expect(text(depositState({ ...baseInput(), capacity: 2, stakerCount: 2 }))).toContain("Both spots are taken.");
    expect(text(depositState({ ...baseInput(), capacity: 3, stakerCount: 3 }))).toContain("All 3 spots are taken.");
  });

  it("a refunded guest keeps the reason", () => {
    expect(text(depositState({ ...baseInput(), phase: 3, guest: guest({ status: 3 }) }))).toContain(
      "The organiser cancelled the event.",
    );
    const missed = depositState({
      ...baseInput(),
      phase: 0,
      guest: guest({ status: 3 }),
      history: { paidTx: FIXTURE.tx },
    });
    expect(text(missed)).toContain("Attendance was not confirmed in time.");
    expect(text(missed)).toContain("Refund transaction");
  });

  it("explains money from a split Kleros share, and not for an undelivered share", () => {
    const share = parseEther("0.013");
    const extra = parseEther("0.002");
    const paid = depositState({
      ...baseInput(),
      phase: 2,
      heldSplit: extra,
      guest: guest({ attended: true, sharePaid: share, claimable: extra }),
    });
    expect(text(paid)).toContain("You already have your share.");
    // a refused push: the claimable is the guest's own share, more than the split
    const owed = depositState({
      ...baseInput(),
      phase: 2,
      heldSplit: extra,
      guest: guest({ attended: true, sharePaid: share + extra, claimable: share + extra }),
    });
    expect(text(owed)).toBe("Thanks for coming. Here is your payout. ");
    const unclaimed = depositState({
      ...baseInput(),
      phase: 2,
      heldSplit: extra,
      guest: guest({ attended: true, claimable: share + extra }),
    });
    expect(text(unclaimed)).toContain("It includes 0.002 ETH from a split Kleros case share.");
    expect(
      text({
        ...depositState({
          ...baseInput(),
          phase: 2,
          heldSplit: extra,
          heldSplitCount: 2,
          guest: guest({ attended: true, claimable: share + extra }),
        }),
      }),
    ).toContain("It includes 0.002 ETH from 2 split Kleros case shares.");
    expect(
      text(
        depositState({
          ...baseInput(),
          phase: 2,
          heldSplit: extra,
          heldSplitCount: 2,
          guest: guest({ attended: true, sharePaid: share, claimable: extra }),
        }),
      ),
    ).toContain("This extra is 2 Kleros cases' held shares, split among attendees.");
  });

  it("a closed-out guest keeps the deposit transaction", () => {
    const b = baseInput();
    const hist = { txHash: FIXTURE.tx, paidTx: FIXTURE.tx };
    const withdrawn = depositState({ ...b, phase: 3, guest: guest({ status: 3 }), history: hist });
    expect(withdrawn.lines).toHaveLength(2);
    expect(withdrawn.lines[1]?.link?.label).toBe("Deposit");
    expect(withdrawn.lines[1]?.link2?.label).toBe("Refund");
    const paid = depositState({ ...galleryInput("paid-out"), history: hist });
    expect(paid.lines[1]?.link?.label).toBe("Deposit");
    expect(paid.lines[1]?.link2?.label).toBe("Payout");
    const off = depositState({ ...b, phase: 2, guest: guest({ status: 1 }), history: { txHash: FIXTURE.tx } });
    expect(off.key).toBe("not-attended");
    expect(off.lines[1]?.link?.label).toBe("Deposit");
  });

  it("a final refusal leaves no Luma line under the button", () => {
    const refusal = (errorName: string) =>
      depositState({
        ...baseInput(),
        guest: guest({ status: 0 }),
        send: { account: FIXTURE.wallet, status: "error", errorKind: "refused", errorName },
      });
    for (const name of ["TooLate", "EventFull", "WasRejected"]) expect(refusal(name).foot).toBeNull();
    expect(refusal("SomethingElse").foot).toBe("Then give Luma your deposit link.");
  });

  it("hides the invite row once every spot is taken, and says how many spots an empty event has", () => {
    expect(depositState({ ...galleryInput("already"), capacity: 2, stakerCount: 2 }).full).toBe(true);
    expect(depositState({ ...galleryInput("already"), capacity: 3, stakerCount: 2 }).full).toBeUndefined();
    const empty = depositState({ ...galleryInput("rest"), guests: 0, capacity: 1 });
    expect(text(empty)).toContain("Be the first to deposit · 1 spot left.");
  });

  it("a final ruling not recorded yet is never 'jurors are deciding'", () => {
    const view = depositState(galleryInput("execute"));
    expect(view.key).toBe("execute");
    expect(view.action).toBe("execute");
    expect(text(view)).toContain("Jurors ruled you came.");
    expect(text(view)).not.toContain("deciding");
    const plain = depositState({ ...galleryInput("execute"), canExecute: false });
    expect(plain.key).toBe("disputed");
    expect(plain.button).toBe("Waiting for the ruling to be recorded");
  });
});
