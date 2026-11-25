"use client";

import { useState } from "react";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";

import { DEFAULT_CHAIN } from "@/config/chains";

import { LumaMatch } from "./LumaMatch";
import { Messages } from "./Messages";
import { ConfirmDialog } from "./parts";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { assetText, shortHex, TYPED_WORDS } from "../model/view";
import type { GuestRow } from "../operations/read";
import { tx } from "../operations/tx";

const STATUS = ["Not booked", "Booked", "Turned away", "Refunded"] as const;
const TONE = ["end", "ok", "warn", "end"] as const;

function statusText(row: GuestRow, phase: number) {
  if (row.status !== 1) return STATUS[row.status] ?? "Unknown";
  if (phase === 0) return "Booked";
  if (row.attended) return "Attended";
  if (row.challenge?.state === 1) return "Challenged";
  if (row.challenge?.state === 2) return "With Kleros";
  return "Not on the list";
}

export function GuestsScreen() {
  const event = useOrganiserEvent();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<"reject" | "cancel" | null>(null);
  const data = event.overview.data;
  if (!data) return <p className="og-note">Reading the event…</p>;
  const info = data.event;
  const open = info.phase === 0 && data.now <= info.claimDeadline;
  const canAct = event.isOwner && open && !event.busy;
  const chosen = data.guests.filter((g) => ticked.has(g.wallet.toLowerCase()) && g.status === 1);
  const explorer = DEFAULT_CHAIN.blockExplorers?.default.url;
  const toggle = (wallet: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(wallet.toLowerCase());
    else next.delete(wallet.toLowerCase());
    setTicked(next);
  };

  return (
    <div className="flex flex-col gap-5" data-testid="guests">
      <div className="flex flex-col gap-1">
        <h2 className="kb-h1">Guests</h2>
        <p className="og-lede">
          A deposit is a booking. Turn away anyone who should not come: they get their{" "}
          {assetText(info.depositAmount, info)} back in full and cannot book again.
        </p>
      </div>
      {data.guests.length === 0 ? (
        <GlassCard className="og-card" data-testid="guests-empty">
          <h3 className="og-h2">No bookings yet</h3>
          <p className="og-lede">Guests show here as soon as they deposit on the event page.</p>
        </GlassCard>
      ) : (
        <div className="og-table" role="table" aria-label="Guests">
          <div className="og-thead" role="row">
            <span>Wallet</span>
            <span>Deposit</span>
            <span>Explorer</span>
            <span>Status</span>
            <span>Tick</span>
          </div>
          {data.guests.map((row) => (
            <div key={row.wallet} className="og-row" data-testid="guest-row" data-wallet={row.wallet.toLowerCase()}>
              <div className="og-row-main">
                <span className="og-cell-wallet og-mono" title={row.wallet}>
                  {shortHex(row.wallet)}
                </span>
                <span className="og-cell-hide kb-num">{assetText(info.depositAmount, info)}</span>
                <span className="og-cell-hide">
                  {explorer ? (
                    <a className="kb-link" href={`${explorer}/address/${row.wallet}`} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="og-cell-status">
                  <span className="og-dot" data-tone={TONE[row.status] ?? "end"} aria-hidden />
                  <span>{statusText(row, info.phase)}</span>
                </span>
                <span className="og-ticks">
                  <label className="og-tick">
                    <input
                      type="checkbox"
                      checked={ticked.has(row.wallet.toLowerCase())}
                      disabled={!canAct || row.status !== 1}
                      aria-label={`Turn away ${row.wallet}`}
                      onChange={(e) => toggle(row.wallet, e.currentTarget.checked)}
                    />
                    <span>Turn away</span>
                  </label>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <Messages event={event} />
      <LumaMatch booked={data.guests.filter((g) => g.status === 1).map((g) => g.wallet)} />
      {!open && <p className="og-note">Guests can only be turned away before the attendance list is posted.</p>}
      <GlassCard className="og-selbar og-thumb">
        <span className="og-note" data-testid="selection">
          {chosen.length} selected · {info.stakerCount} booked
        </span>
        <div className="og-actions">
          <GradientButton className="is-quiet" isDisabled={!canAct} onPress={() => setConfirm("cancel")}>
            Cancel the event
          </GradientButton>
          <GradientButton
            isDisabled={!canAct || chosen.length === 0}
            isPending={event.running?.startsWith("Turn away")}
            glyph={event.running?.startsWith("Turn away") ? "arc" : undefined}
            onPress={() => setConfirm("reject")}
          >
            {`Turn away ${chosen.length}`}
          </GradientButton>
        </div>
      </GlassCard>
      {confirm === "reject" && (
        <ConfirmDialog
          isOpen
          title="Turn guests away"
          intro={`Each wallet gets ${assetText(info.depositAmount, info)} back now and cannot book this event again.`}
          words={[]}
          figures={[
            { label: "Wallets", value: String(chosen.length) },
            { label: "Refunded", value: assetText(info.depositAmount * BigInt(chosen.length), info) },
          ]}
          extra={
            <ul className="og-mono" style={{ overflowWrap: "anywhere" }}>
              {chosen.map((g) => (
                <li key={g.wallet}>{g.wallet}</li>
              ))}
            </ul>
          }
          action={`Turn away ${chosen.length}`}
          busy={event.busy}
          error={null}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const wallets = chosen.map((g) => g.wallet);
            setConfirm(null);
            setTicked(new Set());
            event.run(
              `Turn away ${wallets.length}`,
              () => tx.reject(info.contract, wallets),
              `${wallets.length} turned away and refunded.`,
            );
          }}
        />
      )}
      {confirm === "cancel" && (
        <ConfirmDialog
          isOpen
          title="Cancel the event"
          intro="Every booked guest can then withdraw their full deposit. This cannot be undone."
          words={[TYPED_WORDS.cancel]}
          figures={[{ label: "Booked guests", value: String(info.stakerCount) }]}
          action="Cancel the event"
          busy={event.busy}
          error={null}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            event.run(
              "Cancel",
              () => tx.cancel(info.contract),
              "The event is cancelled. Guests can withdraw their deposits.",
            );
          }}
        />
      )}
    </div>
  );
}
