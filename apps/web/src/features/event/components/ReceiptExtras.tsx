"use client";

import { ShareRow } from "./ShareRow";
import type { DepositView } from "../model/depositState";

export function ReceiptExtras({
  view,
  text,
  luma,
  guestLink,
}: {
  view: DepositView;
  text: string;
  luma: string;
  guestLink: string;
}) {
  if ((view.key !== "done" && view.key !== "already") || !view.receipt) return null;
  return (
    <section className="receipt-extras" aria-label="Share and save your ticket" data-testid="receipt-extras">
      <ShareRow text={text} luma={luma} guestLink={guestLink} />
    </section>
  );
}
