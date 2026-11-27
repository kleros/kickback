"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "react-aria-components";

import { CopyTextButton } from "@/components/ui/CopyButton";

import { CSV_ERROR, ErrorLine, FilePick } from "./parts";
import { forgetLuma, readExport, writeExport } from "../model/lumaBook";
import { hasWalletColumn, matchLuma, type LumaMatchRow } from "../model/lumaMatch";
import { shortHex, when } from "../model/view";

const MATCH_TEXT = { deposit: "Deposit found", none: "No deposit", "no-wallet": "No wallet" } as const;
const MATCH_TONE = { deposit: "ok", none: "err", "no-wallet": "end" } as const;

/** Luma registrations next to the deposits: who to approve on Luma, by verified wallet. */
export function LumaMatch({
  contract,
  booked,
  onRows,
  ended = false,
}: {
  /** The event: the last export loaded for it is kept in this browser. */
  contract?: string;
  booked: readonly string[];
  /** The event is over: the export only adds names to the guest list and the record, nothing is left to approve. */
  ended?: boolean;
  /** Called with the parsed rows, so names can be shown next to wallets on this device. */
  onRows?: (rows: readonly LumaMatchRow[]) => void;
}) {
  const [csv, setCsv] = useState<{ name: string; text: string; at?: number } | null>(null);
  // the export loaded last time (raw text only: the matches are worked out again against today's deposits)
  useEffect(() => {
    if (!contract) return;
    const load = () => setCsv(readExport(contract));
    load();
    window.addEventListener("storage", load);
    window.addEventListener("kb-luma", load);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener("kb-luma", load);
    };
  }, [contract]);
  const [err, setErr] = useState<{ text: string; at: number } | null>(null);
  const rows = useMemo(() => (csv ? matchLuma(csv.text, booked) : null), [csv, booked]);
  // without the verified wallet column nothing can be matched: never tell the organiser to decline everyone
  const noWalletCol = csv ? !hasWalletColumn(csv.text) : false;
  const found = rows?.filter((r) => r.match === "deposit" && !r.dupOf) ?? [];
  const toApprove = found.filter((r) => r.luma === "pending");
  const toDecline = rows?.filter((r) => r.match !== "deposit" && r.luma === "pending") ?? [];
  // approved on Luma, but no booked deposit (no wallet, never paid, or turned away and refunded): their Luma QR
  // code still works
  const wronglyIn = rows?.filter((r) => r.match !== "deposit" && r.luma === "approved") ?? [];
  // a second request on one wallet that is still open on Luma: decline it, so one deposit has one QR code
  const dups = rows?.filter((r) => r.dupOf && r.luma !== "declined") ?? [];
  const mails = (list: readonly LumaMatchRow[]) => list.map((r) => r.email).filter(Boolean);
  const count = (k: number) => `${k} ${k === 1 ? "email" : "emails"}`;
  const approveMails = mails(toApprove);
  const declineMails = mails(toDecline);
  const wrongMails = mails([...new Set([...wronglyIn, ...dups])]);
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  return (
    <section className="flex flex-col gap-3" data-testid="luma-match">
      <div className="flex flex-col gap-1">
        <h2 className="og-h2">{ended ? "Load the Luma guest export" : "Match all Luma requests"}</h2>
        <p className="og-lede">
          {ended
            ? "On Luma, open Guests and export the list (CSV), then choose it here. It adds each guest's name to the guest list and to the record you download. Names and emails stay in this browser only; nothing from the export goes on the blockchain."
            : "On Luma, open Guests and export the list (CSV), then choose it here. Each request is matched by the wallet Luma verified, so you see at once who has a deposit and can copy their emails. Names and emails stay in this browser only; nothing from the export goes on the blockchain."}
        </p>
      </div>
      <FilePick
        label="Luma guest export"
        hint="The CSV from Luma's Guests tab"
        file={csv && rows ? { name: csv.name, rows: rows.length } : null}
        onFile={(name, text) => {
          let parsed: readonly LumaMatchRow[];
          try {
            parsed = matchLuma(text, booked);
          } catch {
            setCsv(null);
            setErr({ text: CSV_ERROR, at: Date.now() });
            return;
          }
          setErr(null);
          const at = Date.now();
          setCsv({ name, text, at });
          if (contract) writeExport(contract, { name, text, at });
          if (hasWalletColumn(text)) onRows?.(parsed);
        }}
        testId="luma-csv"
      />
      <ErrorLine error={err} />
      {csv && rows && (
        <p className="og-note" data-testid="luma-loaded">
          {csv.at ? `Loaded ${when(Math.floor(csv.at / 1000))}. ` : ""}Luma statuses are from that export; export again
          for the latest.{" "}
          {contract && (
            <Button
              className="kb-link kb-tap"
              onPress={() => {
                forgetLuma(contract);
                setCsv(null);
              }}
            >
              Forget this export
            </Button>
          )}
        </p>
      )}
      {rows && noWalletCol && (
        <p className="og-err" role="alert" data-testid="luma-no-wallet">
          This export has no Ethereum wallet column. On the Luma ticket, turn on “Require Ethereum wallet”, then export
          the guest list again.
        </p>
      )}
      {rows && !noWalletCol && (
        <div className="flex flex-col gap-3 border-t border-[var(--kb-hair)] pt-3">
          {ended ? (
            <p className="og-lede" data-testid="luma-summary">
              {`${found.length} of ${rows.length} ${plural(rows.length, "request", "requests")} had a deposit. The event is over: nothing to approve or decline on Luma.`}
            </p>
          ) : (
            <>
              <p className="og-lede" data-testid="luma-summary">
                {`${found.length} of ${rows.length} ${plural(rows.length, "request", "requests")} ${plural(found.length, "has", "have")} a deposit`}
                {toApprove.length > 0
                  ? `; ${toApprove.length} still ${plural(toApprove.length, "needs", "need")} approval on Luma.`
                  : "."}{" "}
                {toDecline.length > 0 &&
                  `${toDecline.length} pending ${plural(toDecline.length, "request has", "requests have")} no deposit: decline ${plural(toDecline.length, "it", "them")}, or ask the ${plural(toDecline.length, "guest", "guests")} to deposit first. `}
                {dups.length > 0 &&
                  `${dups.length} ${plural(dups.length, "request shares", "requests share")} a wallet with another request: decline ${plural(dups.length, "it", "them")} on Luma. `}
                {wronglyIn.length > 0 &&
                  `${wronglyIn.length} approved ${plural(wronglyIn.length, "request has", "requests have")} no deposit (no wallet, never deposited, or turned away): decline ${plural(wronglyIn.length, "it", "them")} on Luma.`}
              </p>
              {approveMails.length + declineMails.length + wrongMails.length > 0 && (
                <>
                  <div className="og-actions">
                    {approveMails.length > 0 && (
                      <CopyTextButton
                        value={approveMails.join(", ")}
                      >{`Copy ${count(approveMails.length)} to approve`}</CopyTextButton>
                    )}
                    {declineMails.length > 0 && (
                      <CopyTextButton
                        value={declineMails.join(", ")}
                      >{`Copy ${count(declineMails.length)} with no deposit`}</CopyTextButton>
                    )}
                    {wrongMails.length > 0 && (
                      <CopyTextButton
                        value={wrongMails.join(", ")}
                      >{`Copy ${count(wrongMails.length)} to decline`}</CopyTextButton>
                    )}
                  </div>
                  <p className="og-note">On Luma, search each email under Guests.</p>
                </>
              )}
            </>
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
                  <span className="og-cell-lname" title={r.email}>
                    {r.name}
                  </span>
                  <span className="og-mono og-cell-hide" title={r.wallet ?? undefined}>
                    {r.wallet ? shortHex(r.wallet) : "—"}
                  </span>
                  <span className="og-cell-luma" data-luma={r.luma}>
                    <span className="og-only-phone">Luma: </span>
                    {r.luma === "pending" ? "Pending" : r.luma === "approved" ? "Approved" : "Declined"}
                  </span>
                  <span className="og-cell-status">
                    <span className="og-dot" data-tone={r.dupOf ? "warn" : MATCH_TONE[r.match]} aria-hidden />
                    <span>
                      {r.dupOf
                        ? r.luma === "declined" || ended
                          ? `Same wallet as ${r.dupOf}`
                          : `Same wallet as ${r.dupOf}: decline this one`
                        : MATCH_TEXT[r.match]}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
