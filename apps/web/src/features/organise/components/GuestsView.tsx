"use client";

import { Button } from "react-aria-components";

import { Disclosure } from "@/components/ui/Disclosure";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientButton } from "@/components/ui/GradientButton";

import { ErrorLine, FilePick } from "./parts";
import { useGuestsScreen, type GuestFilter, type GuestsScreenModel } from "../hooks/useGuestsScreen";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { ethText, shortHex, statusTone } from "../model/view";

const FILTERS: { key: GuestFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "register", label: "To register" },
  { key: "refund", label: "To refund" },
  { key: "look", label: "Needs a look" },
];

type Row = GuestsScreenModel["rows"][number];

function GuestRow({ row, setTick, locked }: { row: Row; setTick: GuestsScreenModel["setTick"]; locked: boolean }) {
  const tick = (kind: "register" | "refund") => {
    const gate = kind === "register" ? row.canRegister : row.canRefund;
    return (
      <label className="og-tick" title={gate.lockedReason ?? undefined}>
        <input
          type="checkbox"
          checked={row.tick === kind}
          disabled={!gate.enabled || locked}
          aria-label={`${kind === "register" ? "Register" : "Refund"} ${row.wallet}`}
          onChange={(event) => setTick(row.id, event.currentTarget.checked ? kind : null)}
        />
        <span>{kind === "register" ? "Register" : "Refund"}</span>
      </label>
    );
  };
  return (
    <div className="og-row" data-testid="guest-row" data-wallet={row.wallet.toLowerCase()}>
      <div className="og-row-main">
        <span className="og-cell-wallet">{shortHex(row.wallet)}</span>
        <span className="og-cell-hide kb-num">{ethText(row.amount)}</span>
        <span className="og-cell-hide">{row.name || "—"}</span>
        <span className="og-cell-status">
          <span className="og-dot" data-tone={statusTone(row.status)} aria-hidden />
          <span>{row.status}</span>
        </span>
        <span className="og-ticks">
          {tick("register")}
          {tick("refund")}
        </span>
      </div>
      <Disclosure title="Details">
        <dl className="og-detail">
          <div>
            <dt>Wallet</dt>
            <dd className="og-mono">{row.wallet}</dd>
          </div>
          <div>
            <dt>Transaction</dt>
            <dd>
              {row.explorer ? (
                <a className="kb-link og-mono" href={row.explorer} target="_blank" rel="noreferrer">
                  {shortHex(row.tx, 6)}
                </a>
              ) : (
                <span className="og-mono">{row.tx ? shortHex(row.tx, 6) : "—"}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Amount · sent</dt>
            <dd>
              {ethText(row.amount)} · {row.sentAt ?? "—"}
            </dd>
          </div>
          <div>
            <dt>Luma</dt>
            <dd>{row.name || "Not on the Luma list"}</dd>
          </div>
          {!row.canRegister.enabled && (
            <div>
              <dt>Register</dt>
              <dd>{row.canRegister.lockedReason}</dd>
            </div>
          )}
        </dl>
      </Disclosure>
    </div>
  );
}

export function GuestsView({ model }: { model: GuestsScreenModel }) {
  const selected = model.toRegister + model.toRefund;
  const locked = model.busy || model.running !== null;
  return (
    <div className="flex flex-col gap-5" data-testid="guests">
      <h2 className="kb-h1">Guests</h2>
      <FilePick
        label="Load the Luma guest list"
        hint="Export the guest CSV from Luma"
        file={model.file ? { name: model.file, rows: model.total } : null}
        onFile={model.loadCsv}
        testId="luma-csv"
      />
      {model.csvLoaded && (
        <div className="og-actions">
          <Button className="kb-link" onPress={model.checkAgain} isDisabled={model.checking}>
            {model.checking ? "Checking…" : "Check again"}
          </Button>
        </div>
      )}
      {model.readError && <ErrorLine error={model.readError} />}
      {model.loading ? (
        <p className="og-note">Reading deposits…</p>
      ) : model.total === 0 ? (
        <GlassCard className="og-card" data-testid="guests-empty">
          <h3 className="og-h2">No deposits yet</h3>
          <p className="og-lede">Deposits show here as guests send them. Load the Luma list to match them.</p>
        </GlassCard>
      ) : (
        <>
          <div className="og-filters" role="group" aria-label="Filter guests">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                className="og-filter"
                aria-pressed={model.filter === f.key}
                data-selected={model.filter === f.key ? "" : undefined}
                onPress={() => model.setFilter(f.key)}
              >
                {`${f.label} ${model.counts[f.key]}`}
              </Button>
            ))}
          </div>
          <div className="og-table" role="table" aria-label="Deposits">
            <div className="og-thead" role="row">
              <span>Wallet</span>
              <span>Amount</span>
              <span>Luma</span>
              <span>Verdict</span>
              <span>Tick</span>
            </div>
            {model.rows.map((row) => (
              <GuestRow key={row.id} row={row} setTick={model.setTick} locked={locked} />
            ))}
          </div>
        </>
      )}
      <ErrorLine error={model.error} />
      {model.done && (
        <p className="og-success" role="status" data-testid="done">
          {model.done}
        </p>
      )}
      <GlassCard className="og-selbar og-thumb">
        <span className="og-note" data-testid="selection">
          {selected} selected · {model.total} deposits
        </span>
        <div className="og-actions">
          <GradientButton
            className="is-quiet"
            isDisabled={!model.toRefund || locked}
            isPending={model.running === "refund"}
            glyph={model.running === "refund" ? "arc" : undefined}
            onPress={model.refund}
          >
            {`Refund ${model.toRefund}`}
          </GradientButton>
          <GradientButton
            isDisabled={!model.toRegister || locked}
            isPending={model.running === "register"}
            glyph={model.running === "register" ? "arc" : undefined}
            onPress={model.register}
          >
            {`Register ${model.toRegister}`}
          </GradientButton>
        </div>
      </GlassCard>
    </div>
  );
}

export function GuestsScreen() {
  const { overview, scope } = useOrganiserEvent();
  if (!overview.data) return <p className="og-note">Reading the event…</p>;
  return <GuestsLoaded cfg={overview.data.cfg} scope={scope} />;
}

function GuestsLoaded({
  cfg,
  scope,
}: {
  cfg: Parameters<typeof useGuestsScreen>[0];
  scope: Parameters<typeof useGuestsScreen>[1];
}) {
  const model = useGuestsScreen(cfg, scope);
  return <GuestsView model={model} />;
}
