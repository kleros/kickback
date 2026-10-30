import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CopyButton } from "../CopyButton";
import { Dialog } from "../Dialog";
import { GradientButton } from "../GradientButton";
import { NumberPop } from "../NumberPop";
import { SegmentedNav } from "../SegmentedNav";
import { TextSwap } from "../TextSwap";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("GradientButton", () => {
  it("presses, and while pending keeps its label beside the glyph and ignores presses", async () => {
    const onPress = vi.fn();
    const { rerender } = render(<GradientButton onPress={onPress}>Deposit</GradientButton>);
    await userEvent.click(screen.getByRole("button", { name: "Deposit" }));
    expect(onPress).toHaveBeenCalledOnce();

    rerender(
      <GradientButton onPress={onPress} isPending glyph="arc">
        Deposit
      </GradientButton>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-pending", "true");
    expect(button.querySelector('[data-glyph="arc"]')).not.toBeNull();
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("shows the success check", () => {
    render(<GradientButton glyph="success">Done</GradientButton>);
    expect(document.querySelector('.t-success-check[data-state="in"]')).not.toBeNull();
  });
});

describe("TextSwap", () => {
  it("swaps the text after the exit", () => {
    vi.useFakeTimers();
    const { rerender } = render(<TextSwap>Deposit</TextSwap>);
    rerender(<TextSwap>Confirming</TextSwap>);
    expect(screen.getByText("Deposit")).toHaveClass("is-exit");
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByText("Confirming")).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("CopyButton", () => {
  it("copies, morphs to a check and reads Copied, then resets", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<CopyButton value="0xabc" label="Copy wallet address" />);
    await user.click(screen.getByRole("button", { name: "Copy wallet address" }));
    expect(writeText).toHaveBeenCalledWith("0xabc");
    expect(screen.getByRole("button", { name: "Copied" })).toHaveAttribute("data-copied");
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("button", { name: "Copy wallet address" })).not.toHaveAttribute("data-copied");
    vi.useRealTimers();
  });
});

describe("Dialog", () => {
  it("closes from its button, but not while busy", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Dialog isOpen onOpenChange={onOpenChange} title="Post the list" isBusy>
        body
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();

    rerender(
      <Dialog isOpen onOpenChange={onOpenChange} title="Post the list">
        body
      </Dialog>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("NumberPop", () => {
  it("pops every digit on first show, then only the changed ones", () => {
    const { rerender, container } = render(<NumberPop value="26" />);
    const group = () => container.querySelector(".t-digit-group")!;
    expect(group()).toHaveClass("is-animating");
    expect(screen.getByLabelText("26")).toBeInTheDocument();
    rerender(<NumberPop value="27" />);
    const digits = group().querySelectorAll(".t-digit");
    expect(digits[0]).toHaveAttribute("data-same");
    expect(digits[1]).not.toHaveAttribute("data-same");
  });

  it("stays still when asked", () => {
    const { container } = render(<NumberPop value="0.01" still />);
    expect(container.querySelector(".t-digit-group")).not.toHaveClass("is-animating");
  });
});

describe("SegmentedNav", () => {
  it("marks the current route and places the pill", () => {
    render(
      <SegmentedNav
        label="Organise"
        current="/b"
        items={[
          { href: "/a", label: "Overview" },
          { href: "/b", label: "Guests" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Guests" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(document.querySelector(".kb-seg-pill")).not.toBeNull();
  });
});
