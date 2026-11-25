"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "react-aria-components";
import { useAccount } from "wagmi";

import { GlassCard } from "@/components/ui/GlassCard";

import { paths } from "@/config/paths";

import { BrowserEvents } from "./BrowserEvents";
import { ErrorLine } from "./parts";
import { WalletEvents } from "./WalletEvents";
import { useBrowserEvents } from "../hooks/useMyEvents";
import { openAddress } from "../model/view";

/** Open an event by its contract address, or create one. */
export function OrganiseHome() {
  const router = useRouter();
  const events = useBrowserEvents();
  const { address: wallet } = useAccount();
  const [text, setText] = useState("");
  const [error, setError] = useState<{ text: string; at: number } | null>(null);
  const open = () => {
    const result = openAddress(text);
    if (result.error) return setError({ text: result.error, at: Date.now() });
    if (wallet && result.address!.toLowerCase() === wallet.toLowerCase())
      return setError({ text: "That is your wallet address. Your events are listed above.", at: Date.now() });
    router.push(paths.organiseEvent.getHref(result.address!));
  };
  return (
    <div className="og-page og-narrow" data-testid="organise-home">
      <div className="flex flex-col gap-2">
        <h1 className="kb-h1">Organise an event</h1>
        <p className="og-lede">Take refundable deposits, post who came, and pay the pool to the guests who did.</p>
      </div>
      <Link href={paths.organiseNew.getHref()} className="kb-btn is-wide" data-testid="create-event">
        Create an event
      </Link>
      <WalletEvents />
      <GlassCard as="section" className="og-card">
        <h2 className="og-h2">Open an event</h2>
        <p className="og-note">
          Lost the link? Connect the wallet that created the event: your events are listed below.
        </p>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            open();
          }}
        >
          <label className="og-field">
            <span className="og-label">Contract address</span>
            <input
              className="og-input is-mono"
              value={text}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setText(event.currentTarget.value)}
            />
          </label>
          <ErrorLine error={error} />
          <Button type="submit" className="kb-btn is-quiet">
            Open
          </Button>
        </form>
      </GlassCard>
      <BrowserEvents events={events} />
    </div>
  );
}
