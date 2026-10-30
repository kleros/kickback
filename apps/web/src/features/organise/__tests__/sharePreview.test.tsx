import { describeWhen } from "@kickback/core";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { CreateForm } from "../components/CreateView";
import { formErrors } from "../hooks/useCreateScreen";
import { createSharePreview } from "../model/sharePreview";

vi.mock("@/lib/web3/send", () => ({ useSend: vi.fn(), useSendBusy: () => false }));
vi.mock("@/lib/web3/chain-time", () => ({ useChainTime: vi.fn() }));

const values = {
  share: "{event} | {date} | {venue} | {luma} | {guestLink}",
  title: "Our dinner",
  start: "2026-11-04T18:00",
  zoneName: "IST",
  venue: "Mumbai",
  registrationLink: "https://luma.com/dinner",
};
it("fills the preview from the form rather than sample event values", () => {
  expect(createSharePreview(values, "https://kickback.test/event/123")).toBe(
    "Our dinner | 2026-11-04 18:00 IST | Mumbai | https://luma.com/dinner | https://kickback.test/event/123",
  );
  expect(createSharePreview({ ...values, share: "" })).toContain("I just locked my spot at Our dinner");
});
it("updates the visible preview when form values change", () => {
  const { rerender } = render(<CreateForm values={values} errors={{}} onChange={vi.fn()} />);
  expect(screen.getByLabelText("Share template")).toHaveValue(values.share);
  expect(screen.getByTestId("share-preview")).toHaveTextContent("Our dinner");
  rerender(<CreateForm values={{ ...values, title: "Our lunch" }} errors={{}} onChange={vi.fn()} />);
  expect(screen.getByTestId("share-preview")).toHaveTextContent("Our lunch");
});
it("attaches invalid placeholders to the share field", () => {
  expect(formErrors({ ...values, share: "{wallet}" }).share).toContain("{event}");
});

it("previews the same full event clock text that the create flow pins", () => {
  const full = { ...values, share: "{date}", end: "2026-11-04T22:00", timezoneOffset: "+05:30" };
  expect(createSharePreview(full)).toBe(describeWhen("2026-11-04T18:00:00+05:30", "2026-11-04T22:00:00+05:30", "IST"));
});
