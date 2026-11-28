"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { paths } from "@/config/paths";

import { WalletEvents } from "./WalletEvents";

/** "Manage your events": the events the connected wallet created, and nothing else. */
export function OrganiseHome({ renderEvents }: { renderEvents?: ComponentProps<typeof WalletEvents>["renderEvents"] }) {
  return (
    <div className="og-page og-narrow" data-testid="organise-home">
      <div className="flex flex-col gap-2">
        <h1 className="kb-h1">Manage your events</h1>
        <p className="og-lede">
          Your events, found by the wallet that organises them. Open one to check guests, confirm who came and release
          payouts.
        </p>
      </div>
      <WalletEvents renderEvents={renderEvents} />
      <p className="og-note">
        New event?{" "}
        <Link className="kb-link kb-tap" href={paths.organiseNew.getHref()} data-testid="create-event">
          Create an event
        </Link>
      </p>
    </div>
  );
}
