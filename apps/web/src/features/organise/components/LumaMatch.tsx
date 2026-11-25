"use client";

import { useMemo, useState } from "react";

import { CopyButton } from "@/components/ui/CopyButton";
import { GlassCard } from "@/components/ui/GlassCard";

import { FilePick } from "./parts";
import { matchLuma } from "../model/lumaMatch";
import { shortHex } from "../model/view";

const MATCH_TEXT = { deposit: "Deposit found", none: "No deposit", "no-wallet": "No wallet" } as const;
const MATCH_TONE = { deposit: "ok", none: "err", "no-wallet": "end" } as const;

/** Luma registrations next to the deposits: who to approve on Luma, by verified wallet. */
export function LumaMatch({ booked }: { booked: readonly string[] }) {
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const rows = useMemo(() => (csv ? matchLuma(csv.text, booked) : null), [csv, booked]);
  const found = rows?.filter((r) => r.match === "deposit") ?? [];
  const toApprove = found.filter((r) => r.luma === "pending");
  return (
    <section className="flex flex-col gap-3" data-testid="luma-match">
      <div className="flex flex-col gap-1">
        <h2 className="og-h2">Match Luma registrations</h2>
        <p className="og-lede">
          On Luma, open Guests, export the guest list (CSV) and drop it here. Each registration is matched by the wallet
          Luma verified, so you can approve everyone with a deposit in one go.
        </p>
      </div>
      <FilePick
        label="Luma guest export"
        hint="The CSV from Luma's Guests tab"
        file={csv && rows ? { name: csv.name, rows: rows.length } : null}
        onFile={(name, text) => setCsv({ name, text })}
        testId="luma-csv"
      />
      {rows && (
        <GlassCard className="og-card">
          <p className="og-lede" data-testid="luma-summary">
            {found.length} of {rows.length} registrations have a deposit. {toApprove.length} still to approve on Luma.
          </p>
          {toApprove.some((r) => r.email) && (
            <p className="og-note flex items-center gap-2">
              Emails to approve on Luma
              <CopyButton
                value={toApprove
                  .map((r) => r.email)
                  .filter(Boolean)
                  .join(", ")}
                label="Copy emails to approve"
              />
            </p>
          )}
          <div className="og-table is-luma" role="table" aria-label="Luma registrations">
            <div className="og-thead" role="row">
              <span>Name</span>
              <span>Wallet</span>
              <span>Luma</span>
              <span>Deposit</span>
            </div>
            {rows.map((r, i) => (
              <div key={`${r.wallet ?? "none"}-${i}`} className="og-row" data-testid="luma-row" data-match={r.match}>
                <div className="og-row-main">
                  <span title={r.email}>{r.name}</span>
                  <span className="og-mono og-cell-hide" title={r.wallet ?? undefined}>
                    {r.wallet ? shortHex(r.wallet) : "—"}
                  </span>
                  <span className="og-cell-hide">
                    {r.luma === "pending" ? "Pending" : r.luma === "approved" ? "Approved" : "Declined"}
                  </span>
                  <span className="og-cell-status">
                    <span className="og-dot" data-tone={MATCH_TONE[r.match]} aria-hidden />
                    <span>{MATCH_TEXT[r.match]}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </section>
  );
}
