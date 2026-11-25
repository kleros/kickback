"use client";

import { useMemo, useRef, useState } from "react";

import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";

import { DEFAULT_CHAIN } from "@/config/chains";

import { GuestCheck } from "./GuestCheck";
import { LumaMatch } from "./LumaMatch";
import { Messages } from "./Messages";
import { ConfirmDialog } from "./parts";
import { useLumaBook } from "../hooks/useLumaBook";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { assetText, shortHex } from "../model/view";
import type { GuestRow } from "../operations/read";
import { tx } from "../operations/tx";

const STATUS = ["No deposit", "Deposited", "Turned away", "Refunded"] as const;
const TONE = ["end", "ok", "warn", "end"] as const;

function statusText(row: GuestRow, phase: number) {
  if (row.status !== 1) return STATUS[row.status] ?? "Unknown";
  if (phase === 0) return "Deposited";
  if (row.attended) return "Came";
  if (row.challenge?.state === 1) return "Challenged";
  if (row.challenge?.state === 2) return "With Kleros";
  return "Not on the list";
}

export function GuestsScreen() {
  const event = useOrganiserEvent();
  const luma = useLumaBook(event.address);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [search, setSearch] = useState("");
  const firstSeen = useRef<Set<string> | null>(null);
  const data = event.overview.data;
  const guests = useMemo(() => data?.guests ?? [], [data]);
  const booked = useMemo(() => guests.filter((g) => g.status === 1).map((g) => g.wallet), [guests]);
  if (!data) return <p className="og-note">Reading the event…</p>;
  const info = data.event;
  if (firstSeen.current === null) firstSeen.current = new Set(guests.map((g) => g.wallet.toLowerCase()));
  // the contract turns guests away only before the start (v2)
  const open = info.phase === 0 && data.now < info.eventStart;
  const canAct = event.isOwner && open && !event.busy;
  const chosen = guests.filter((g) => ticked.has(g.wallet.toLowerCase()) && g.status === 1);
  const explorer = DEFAULT_CHAIN.blockExplorers?.default.url;
  const isNew = (wallet: string) => !firstSeen.current?.has(wallet.toLowerCase());
  const q = search.trim().toLowerCase();
  const rows = [...guests].reverse().filter((g) => {
    if (!q) return true;
    const person = luma.names[g.wallet.toLowerCase()];
    return (
      g.wallet.toLowerCase().includes(q) ||
      !!person?.name.toLowerCase().includes(q) ||
      !!person?.email.toLowerCase().includes(q)
    );
  });
  const fresh = guests.filter((g) => isNew(g.wallet)).length;
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
        <p className="og-lede" data-testid="guest-count">
          <b>{info.stakerCount}</b> {info.stakerCount === 1 ? "deposit" : "deposits"}
          {info.capacity ? ` of ${info.capacity} spots` : ""}
          {fresh > 0 && ` · ${fresh} new since you opened this page`}
        </p>
      </div>

      <GlassCard className="og-card">
        <GuestCheck
          contract={event.address}
          guests={guests}
          nameOf={luma.nameOf}
          approvedAt={luma.approvedAt}
          check={luma.check}
        />
      </GlassCard>
      <GlassCard className="og-card">
        <LumaMatch booked={booked} onRows={luma.add} />
      </GlassCard>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="og-h2">All deposits</h2>
          <p className="og-lede">
            {open
              ? `Newest first. Until the event starts you can turn anyone away: they get their ${assetText(info.depositAmount, info)} back in full and cannot deposit again.`
              : "Newest first. Guests could only be turned away until the event started."}
          </p>
        </div>
        {guests.length > 0 && (
          <input
            className="og-input"
            type="search"
            placeholder="Search name, email or wallet"
            aria-label="Search guests"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        )}
        {guests.length === 0 ? (
          <GlassCard className="og-card" data-testid="guests-empty">
            <h3 className="og-h2">No deposits yet</h3>
            <p className="og-lede">Guests appear here as soon as they deposit on the event page.</p>
          </GlassCard>
        ) : (
          <div className={`og-table is-guests${explorer ? "" : " no-explorer"}`} role="table" aria-label="Guests">
            <div className="og-thead" role="row">
              <span>Guest</span>
              <span>Deposit</span>
              {explorer && <span>Explorer</span>}
              <span>Status</span>
              <span className="text-right">{open ? "Turn away" : ""}</span>
            </div>
            {rows.map((row) => {
              const name = luma.nameOf(row.wallet);
              return (
                <div
                  key={row.wallet}
                  className="og-row"
                  data-testid="guest-row"
                  data-wallet={row.wallet.toLowerCase()}
                  data-new={isNew(row.wallet) || undefined}
                >
                  <div className="og-row-main">
                    <span className="og-cell-wallet" title={row.wallet}>
                      {name && <span className="og-cell-name">{name}</span>}
                      <span className="og-mono">{shortHex(row.wallet)}</span>
                      {isNew(row.wallet) && <span className="og-new">New</span>}
                    </span>
                    <span className="og-cell-hide kb-num">{assetText(info.depositAmount, info)}</span>
                    {explorer && (
                      <span className="og-cell-hide">
                        <a
                          className="kb-link"
                          href={`${explorer}/address/${row.wallet}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      </span>
                    )}
                    <span className="og-cell-status">
                      <span className="og-dot" data-tone={TONE[row.status] ?? "end"} aria-hidden />
                      <span>{statusText(row, info.phase)}</span>
                    </span>
                    <span className="og-ticks">
                      {open && (
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
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && <p className="og-note py-3">No guest matches “{search}”.</p>}
          </div>
        )}
        {chosen.length > 0 && (
          <GlassCard className="og-selbar og-thumb">
            <span className="og-note" data-testid="selection">
              {chosen.length} selected
            </span>
            <div className="og-actions">
              <GradientButton className="is-quiet" onPress={() => setTicked(new Set())}>
                Clear
              </GradientButton>
              <GradientButton
                isDisabled={!canAct}
                isPending={event.running?.startsWith("Turn away")}
                glyph={event.running?.startsWith("Turn away") ? "arc" : undefined}
                onPress={() => setConfirm(true)}
              >
                {`Turn away ${chosen.length} · refund now`}
              </GradientButton>
            </div>
          </GlassCard>
        )}
        <Messages event={event} />
      </section>

      {confirm && (
        <ConfirmDialog
          isOpen
          title="Turn guests away"
          intro={`Each wallet gets ${assetText(info.depositAmount, info)} back now and cannot deposit for this event again.`}
          words={[]}
          figures={[
            { label: "Wallets", value: String(chosen.length) },
            { label: "Refunded", value: assetText(info.depositAmount * BigInt(chosen.length), info) },
          ]}
          extra={
            <ul className="og-mono" style={{ overflowWrap: "anywhere" }}>
              {chosen.map((g) => (
                <li key={g.wallet}>
                  {luma.nameOf(g.wallet) ? `${luma.nameOf(g.wallet)} · ` : ""}
                  {g.wallet}
                </li>
              ))}
            </ul>
          }
          action={`Turn away ${chosen.length}`}
          busy={event.busy}
          error={null}
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            const wallets = chosen.map((g) => g.wallet);
            setConfirm(false);
            setTicked(new Set());
            event.run(
              `Turn away ${wallets.length}`,
              () => tx.reject(info.contract, wallets),
              `${wallets.length} turned away and refunded.`,
            );
          }}
        />
      )}
    </div>
  );
}
