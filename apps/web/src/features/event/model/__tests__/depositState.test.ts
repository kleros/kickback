import { describe, expect, it } from "vitest";

import { depositState } from "../depositState";
import { baseInput, galleryInput } from "../fixtures";

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
