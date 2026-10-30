"use client";

import { Button, Menu, MenuItem, MenuTrigger, Popover, Text } from "react-aria-components";

import { ChevronIcon } from "@/components/ui/icons";

import { ConfirmDialog, ErrorLine, Figures, Primary } from "./parts";
import { useOrganiserEvent } from "../hooks/useOrganiserEvent";
import { usePayoutScreen, type PayoutScreenModel, type RareAction } from "../hooks/usePayoutScreen";
import type { EventScope } from "../model/shared";
import { challengeText, ethText, TYPED_WORDS } from "../model/view";

const RARE: { key: RareAction; label: string; hint: string }[] = [
  { key: "sweep", label: "Collect leftovers", hint: "Rounding dust, after payouts or cancellation" },
  { key: "refund", label: "Return stray ETH", hint: "Sent to the contract by mistake" },
  { key: "removeGuest", label: "Remove and refund one guest", hint: "Only while deposits are open" },
  { key: "cancel", label: "Cancel the event", hint: "Refunds every registered guest" },
];

function MoreMenu({ model }: { model: PayoutScreenModel }) {
  const disabled = RARE.filter((item) => !model.gates[item.key].enabled).map((item) => item.key);
  return (
    <MenuTrigger>
      <Button className="kb-btn is-quiet" isDisabled={model.busy} data-testid="more">
        More
        <ChevronIcon />
      </Button>
      <Popover className="og-menu-pop" placement="bottom end" offset={8}>
        <Menu
          className="og-menu"
          aria-label="More actions"
          disabledKeys={disabled}
          onAction={(key) => model.open(key as RareAction)}
        >
          {RARE.map((item) => (
            <MenuItem key={item.key} id={item.key} className="og-menu-item" textValue={item.label}>
              <Text slot="label">{item.label}</Text>
              <Text slot="description">{model.gates[item.key].lockedReason ?? item.hint}</Text>
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function Field({
  label,
  value,
  onChange,
  mono,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="og-field">
      <span className="og-label">{label}</span>
      <input
        className={mono ? "og-input is-mono" : "og-input"}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function PayoutDialog({ model }: { model: PayoutScreenModel }) {
  const frozen = model.frozen;
  if (!frozen) return null;
  const common = {
    isOpen: true,
    busy: model.pending,
    error: model.error,
    onClose: model.close,
    onConfirm: (typed: string[]) => void model.confirm(typed[0] ?? ""),
  };
  if (frozen.action === "release")
    return (
      <ConfirmDialog
        {...common}
        title="Release payouts"
        intro="Read from the chain when you opened this. These are the figures you sign."
        figures={[
          { label: "Pool", value: ethText(frozen.pool) },
          { label: "Attendees", value: String(frozen.attendees) },
          { label: "Each gets", value: ethText(frozen.share) },
          { label: "Held for open challenges", value: ethText(frozen.heldBack) },
        ]}
        words={[TYPED_WORDS.pay]}
        action="Release"
      />
    );
  if (frozen.action === "sweep")
    return (
      <ConfirmDialog
        {...common}
        title="Collect leftovers"
        intro="Sends what the contract holds beyond guests' money to your wallet."
        figures={[{ label: "Leftovers", value: ethText(frozen.spare) }]}
        words={[TYPED_WORDS.sweep]}
        action="Collect"
      />
    );
  if (frozen.action === "cancel")
    return (
      <ConfirmDialog
        {...common}
        title="Cancel the event"
        intro="Every registered guest gets their deposit back. This cannot be undone."
        figures={[
          { label: "Registered guests", value: String(frozen.registered) },
          { label: "Refunded in total", value: ethText(frozen.refundTotal) },
        ]}
        words={[TYPED_WORDS.cancel]}
        action="Cancel the event"
      />
    );
  if (frozen.action === "refund")
    return (
      <ConfirmDialog
        {...common}
        title="Return stray ETH"
        intro="Only money beyond guests' deposits can be returned."
        figures={[{ label: "Spare", value: ethText(frozen.spare) }]}
        words={[]}
        gate={model.dialogGate}
        action="Return"
        extra={
          <>
            <Field
              label="To wallet"
              mono
              value={model.fields.to}
              onChange={(v) => model.setField("to", v)}
              placeholder="0x…"
            />
            <Field
              label="Amount, ETH"
              value={model.fields.amount}
              onChange={(v) => model.setField("amount", v)}
              placeholder="0.01"
            />
          </>
        }
      />
    );
  return (
    <ConfirmDialog
      {...common}
      title="Remove and refund one guest"
      intro="Takes the guest off the list and returns their deposit."
      figures={[]}
      words={[]}
      gate={model.dialogGate}
      action="Remove and refund"
      extra={
        <Field
          label="Guest wallet"
          mono
          value={model.fields.guest}
          onChange={(v) => model.setField("guest", v)}
          placeholder="0x…"
        />
      }
    />
  );
}

export function PayoutView({ model, released }: { model: PayoutScreenModel; released: boolean }) {
  const f = model.figures;
  return (
    <div className="flex flex-col gap-5" data-testid="payout">
      <h2 className="kb-h1">Payout</h2>
      {model.readError && <ErrorLine error={model.readError} />}
      {f ? (
        <Figures
          testId="payout-figures"
          rows={[
            { label: "Pool", value: ethText(f.pool) },
            { label: "Attendees", value: f.attendees === null ? "—" : String(f.attendees) },
            { label: "Each gets", value: ethText(f.share) },
            { label: "Leftovers", value: ethText(f.spare) },
            { label: "Challenges", value: challengeText(f.openChallenges) },
          ]}
        />
      ) : (
        <p className="og-note">Reading the payout…</p>
      )}
      {model.done && (
        <p className="og-success" role="status" data-testid="done">
          {model.done}
        </p>
      )}
      <div className="og-actions">
        {!released && (
          <Primary gate={model.gates.release} onPress={() => model.open("release")} busy={model.busy}>
            Release payouts
          </Primary>
        )}
        <MoreMenu model={model} />
      </div>
      <PayoutDialog model={model} />
    </div>
  );
}

export function PayoutScreen() {
  const { overview, scope } = useOrganiserEvent();
  if (!overview.data) return <p className="og-note">Reading the event…</p>;
  return (
    <PayoutLoaded scope={scope} deposit={overview.data.event.depositAmount} released={overview.data.event.phase >= 2} />
  );
}

function PayoutLoaded({ scope, deposit, released }: { scope: EventScope; deposit: bigint; released: boolean }) {
  const model = usePayoutScreen(scope, deposit);
  return <PayoutView model={model} released={released} />;
}
