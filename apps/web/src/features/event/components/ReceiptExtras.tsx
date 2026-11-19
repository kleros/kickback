"use client";

import { Button } from "react-aria-components";

import { GlassCard } from "@/components/ui/GlassCard";
import { DownloadIcon } from "@/components/ui/icons";

import { ShareRow } from "./ShareRow";
import { useReceiptQr } from "../hooks/useReceiptQr";
import type { DepositView } from "../model/depositState";

function QrStub({
  receipt,
  name,
  amount,
}: {
  receipt: NonNullable<DepositView["receipt"]>;
  name: string;
  amount: string;
}) {
  const qr = useReceiptQr(receipt.txLink);
  return (
    <GlassCard as="section" className="receipt-stub kb-rise" aria-label="Deposit ticket stub" data-testid="qr-stub">
      <div
        ref={qr.ref}
        className="receipt-qr"
        role="img"
        aria-label="Deposit transaction QR code"
        aria-busy={!qr.ready}
        data-testid="receipt-qr"
      />
      <div className="receipt-stub-details">
        <h2>{name}</h2>
        <p>{amount}</p>
        <p className="kb-mono" title={receipt.tx}>
          {receipt.tx.slice(0, 6)}…{receipt.tx.slice(-4)}
        </p>
        <div className="receipt-downloads">
          {(["png", "svg"] as const).map((extension) => (
            <Button
              key={extension}
              className="kb-link"
              isDisabled={!qr.ready || qr.busy}
              onPress={() => void qr.download(extension)}
            >
              <DownloadIcon /> Download {extension.toUpperCase()}
            </Button>
          ))}
        </div>
        {qr.error && <p role="status">{qr.error}</p>}
      </div>
    </GlassCard>
  );
}

export function ReceiptExtras({
  view,
  name,
  amount,
  text,
  luma,
  guestLink,
}: {
  view: DepositView;
  name: string;
  amount: string;
  text: string;
  luma: string;
  guestLink: string;
}) {
  if ((view.key !== "done" && view.key !== "already") || !view.receipt) return null;
  return (
    <section className="receipt-extras" aria-label="Share and save your ticket" data-testid="receipt-extras">
      <ShareRow text={text} luma={luma} guestLink={guestLink} />
      <QrStub receipt={view.receipt} name={name} amount={amount} />
    </section>
  );
}
