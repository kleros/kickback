import { forwardRef } from "react";

import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({ view: { key: "already" }, depositOpen: false }));

import { EventScreen } from "../EventScreen";

vi.mock("../../api/useEvent", () => ({
  EventRefused: class extends Error {},
  useEvent: () => ({
    data: {
      contract: "0x1111111111111111111111111111111111111111",
      depositAmount: 10n,
      eventName: "Dinner",
      stakerCount: 0,
      eventStart: 1000,
      claimDeadline: 10000,
      clock: null,
    },
  }),
  usePreviewShare: () => ({}),
}));
vi.mock("../../hooks/useReceiptShare", () => ({ useReceiptShare: () => ({ text: "", luma: "", guestLink: "" }) }));
vi.mock("../../hooks/useDepositState", () => ({ useDepositState: () => controller }));
vi.mock("../EventHead", () => ({ EventHead: () => null }));
vi.mock("../TicketCard", () => ({
  TicketCard: forwardRef<HTMLDivElement>(function Ticket(_props, ref) {
    return <div ref={ref} data-testid="ticket" />;
  }),
}));
vi.mock("../EventDetails", () => ({ EventDetails: () => <div data-testid="details" /> }));
vi.mock("../HowItWorks", () => ({
  HowItWorks: ({ depositOpen }: { depositOpen: boolean }) => (
    <div data-testid="how">{depositOpen && <button>Deposit 0.01 ETH</button>}</div>
  ),
}));

it("places event details below the ticket and above how it works", () => {
  render(<EventScreen contract="0x1111111111111111111111111111111111111111" />);
  expect(
    screen.getByTestId("ticket").compareDocumentPosition(screen.getByTestId("details")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    screen.getByTestId("details").compareDocumentPosition(screen.getByTestId("how")) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("does not offer a footer deposit when a closed event still shows a receipt", () => {
  render(<EventScreen contract="0x1111111111111111111111111111111111111111" />);
  expect(screen.queryByRole("button", { name: /^Deposit/ })).toBeNull();
});
