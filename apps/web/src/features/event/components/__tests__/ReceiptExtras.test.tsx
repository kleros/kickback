import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { depositState } from "../../model/depositState";
import { galleryInput } from "../../model/fixtures";
import { createQr, downloadQr } from "../../operations/qr";
import { ReceiptExtras } from "../ReceiptExtras";
import { ShareRow } from "../ShareRow";

vi.mock("../../operations/qr", () => ({ createQr: vi.fn(), downloadQr: vi.fn() }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

const props = {
  name: "Dinner",
  amount: "0.01",
  text: "Join 🎉 & friends",
  luma: "https://luma.com/dinner",
  guestLink: "https://kickback.test/event/0x123",
};
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.mocked(createQr).mockResolvedValue({
    getRawData: vi.fn(async () => new Blob()),
    append: vi.fn(),
  } as unknown as Awaited<ReturnType<typeof createQr>>);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each(["done", "already"] as const)("shows share and stub for %s without enlarging the ticket", async (state) => {
  const view = depositState(galleryInput(state));
  render(<ReceiptExtras {...props} view={view} />);
  expect(screen.getByTestId("receipt-extras").querySelector('[data-testid="ticket"]')).toBeNull();
  expect(screen.getByRole("region", { name: "Deposit ticket stub" })).toHaveTextContent("Dinner");
  expect(screen.getByRole("img", { name: "Deposit transaction QR code" })).toHaveClass("receipt-qr");
  expect(createQr).toHaveBeenCalledWith(view.receipt!.txLink, false);
  await waitFor(() => expect(screen.getByRole("button", { name: "Download PNG" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Download PNG" }));
  await waitFor(() => expect(downloadQr).toHaveBeenCalledWith(view.receipt!.txLink, "png"));
  fireEvent.click(screen.getByRole("button", { name: "Download SVG" }));
  await waitFor(() => expect(downloadQr).toHaveBeenCalledWith(view.receipt!.txLink, "svg"));
});
it("does not load QR or render extras at rest", () => {
  render(<ReceiptExtras {...props} view={depositState(galleryInput("rest"))} />);
  expect(createQr).not.toHaveBeenCalled();
  expect(screen.queryByTestId("receipt-extras")).not.toBeInTheDocument();
});
it("keeps the reserved QR space on load failure and leaves sharing available", async () => {
  vi.mocked(createQr).mockRejectedValue(new Error("chunk failed"));
  render(<ReceiptExtras {...props} view={depositState(galleryInput("done"))} />);
  expect(await screen.findByRole("status")).toHaveTextContent("Could not load the QR");
  expect(screen.getByTestId("receipt-qr")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download PNG" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Copy text" })).toBeEnabled();
});
it("opens platform links safely and copies the filled text", async () => {
  const user = userEvent.setup();
  render(<ShareRow {...props} />);
  for (const name of ["X", "Farcaster", "LinkedIn", "Telegram"]) {
    expect(screen.getByRole("link", { name: `Share on ${name}` })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: `Share on ${name}` })).toHaveAttribute("rel", "noopener noreferrer");
  }
  await user.click(screen.getByRole("button", { name: "Copy text" }));
  expect(await navigator.clipboard.readText()).toBe(props.text);
  expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
});
it("uses the phone share sheet and falls back to platforms on failure", async () => {
  const share = vi.fn().mockRejectedValue(new Error("unavailable"));
  vi.stubGlobal("navigator", { ...navigator, share });
  vi.mocked(matchMedia).mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
  render(<ShareRow {...props} />);
  expect(screen.queryByRole("link", { name: "Share on X" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  await waitFor(() => expect(share).toHaveBeenCalledWith({ text: props.text, url: props.luma }));
  expect(await screen.findByRole("link", { name: "Share on X" })).toBeInTheDocument();
});
it("treats share-sheet cancellation as a non-error", async () => {
  const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
  vi.stubGlobal("navigator", { ...navigator, share });
  vi.mocked(matchMedia).mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
  render(<ShareRow {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  await waitFor(() => expect(share).toHaveBeenCalledOnce());
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
});
