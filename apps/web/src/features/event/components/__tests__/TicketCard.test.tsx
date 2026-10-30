import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { depositState } from "../../model/depositState";
import { FIXTURE, GALLERY_STATES, galleryInput } from "../../model/fixtures";
import { TicketCard, type TicketActions } from "../TicketCard";

const actions = (): TicketActions => ({
  connect: vi.fn(),
  switchChain: vi.fn(),
  addChain: vi.fn(),
  deposit: vi.fn(),
  recheck: vi.fn(),
});
const VERIFIED = {
  contract: "0xd5c6A73c05FA431c748781DaBAA99Fe2590d677D",
  disputeResolver: "0x4B89e798B10478A839Ea0Abcf86C4B94A3C782A4",
  arbitrator: "0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069",
  explorer: "https://etherscan.io",
  court: "Kleros Court",
} as const;

const renderState = (state: (typeof GALLERY_STATES)[number], a = actions()) => {
  render(
    <TicketCard
      view={depositState(galleryInput(state))}
      amount="0.01"
      actions={a}
      verified={VERIFIED}
      lumaUrl="https://luma.com/truth-pays"
    />,
  );
  return a;
};

const words = (el: HTMLElement) => (el.textContent ?? "").split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;

describe("TicketCard", () => {
  it.each(GALLERY_STATES)("renders %s with its label, button and a polite status slot", (state) => {
    renderState(state);
    const card = screen.getByRole("region", { name: "Deposit" });
    const view = depositState(galleryInput(state));
    expect(card).toHaveAttribute("data-state", view.key);
    expect(card.querySelector(".tk-label")).toHaveTextContent(view.label);
    expect(screen.getByTestId("ticket-status")).toHaveAttribute("aria-live", "polite");
    expect(
      within(card)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toContain(view.button);
    for (const line of view.lines) expect(within(card).getByText(line.text, { exact: false })).toBeInTheDocument();
  });

  it("keeps the card at rest within 25 visible words", () => {
    renderState("rest");
    const card = screen.getByRole("region", { name: "Deposit" });
    const closedBody = card.querySelector(".kb-disc-inner")!;
    expect(words(card) - words(closedBody as HTMLElement)).toBeLessThanOrEqual(25);
  });

  it.each([
    ["rest", "connect", "Connect wallet"],
    ["wrongnet", "switchChain", "Switch to Ethereum"],
    ["addchain", "addChain", "Add Ethereum to your wallet"],
    ["ready", "deposit", "Deposit"],
  ] as const)("%s presses %s", async (state, action, label) => {
    const a = renderState(state);
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(a[action]).toHaveBeenCalledOnce();
  });

  it("disables the button when there is not enough ETH, and rechecks from the status line", async () => {
    const a = renderState("insufficient");
    expect(screen.getByRole("button", { name: "Not enough ETH" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(a.recheck).toHaveBeenCalledOnce();
  });

  it("marks a busy button pending and keeps its label", () => {
    renderState("signing");
    const button = screen.getByRole("button", { name: /Confirm in your wallet/ });
    expect(button).toHaveAttribute("data-pending", "true");
    expect(button).toHaveTextContent("Confirm in your wallet");
  });

  it("in the done state, copies the transaction link and says Copied; the wallet has its own copy", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    renderState("done");
    await user.click(screen.getByRole("button", { name: /Copy transaction link/ }));
    expect(writeText).toHaveBeenLastCalledWith(`https://etherscan.io/tx/${FIXTURE.tx}`);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy wallet address" }));
    expect(writeText).toHaveBeenLastCalledWith(FIXTURE.wallet);
    expect(screen.getByRole("link", { name: /Back to Luma/ })).toHaveAttribute("href", "https://luma.com/truth-pays");
  });

  it("keeps the verified details inert until opened", async () => {
    renderState("rest");
    const trigger = screen.getByRole("button", { name: "Verified Kleros contract" });
    const inner = document.querySelector(".kb-disc-inner")!;
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(inner).toHaveAttribute("inert");
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(inner).not.toHaveAttribute("inert");
    expect(screen.getByText("Same as the Kickback v7 build")).toBeInTheDocument();
  });

  it("shakes the status slot once when the wallet declines", () => {
    vi.useFakeTimers();
    render(
      <TicketCard
        view={depositState({ ...galleryInput("ready"), send: { status: "error", errorKind: "wallet" } })}
        amount="0.01"
        actions={actions()}
        verified={VERIFIED}
      />,
    );
    expect(screen.getByTestId("ticket-status")).toHaveClass("is-shaking");
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByTestId("ticket-status")).not.toHaveClass("is-shaking");
    vi.useRealTimers();
  });
});
