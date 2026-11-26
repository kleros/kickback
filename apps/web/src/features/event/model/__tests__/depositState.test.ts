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
});
