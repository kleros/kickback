import { forwardRef } from "react";

import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

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
vi.mock("../../hooks/useDepositState", () => ({ useDepositState: () => ({ view: { key: "ready" } }) }));
vi.mock("../EventHead", () => ({ EventHead: () => null }));
vi.mock("../TicketCard", () => ({
  TicketCard: forwardRef<HTMLDivElement>(function Ticket(_props, ref) {
    return <div ref={ref} data-testid="ticket" />;
  }),
}));
vi.mock("../EventDetails", () => ({ EventDetails: () => <div data-testid="details" /> }));
vi.mock("../HowItWorks", () => ({ HowItWorks: () => <div data-testid="how" /> }));

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
