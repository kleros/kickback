import Link from "next/link";
import type { ReactNode } from "react";

import { fmtEth } from "@kickback/core";
import { parseEther } from "viem";

import { GlassCard } from "@/components/ui/GlassCard";

import { isSepolia } from "@/config/chains";
import { paths } from "@/config/paths";

import { payoutExample } from "../model/example";

const ethText = (wei: bigint) => fmtEth(wei, 18).replace(/ ETH$/, "");

const EXAMPLE = payoutExample(parseEther("0.01"), 10, 8);

const STEPS = [
  {
    title: "Register and deposit",
    body: "Guests register on Luma, send the refundable deposit from their own wallet, and paste the deposit link in their Luma registration. The organiser approves them. Anyone turned away before the event starts gets their deposit back in full.",
  },
  {
    title: "Show up",
    body: "Get your Luma QR code scanned at the door. After the event, the organiser confirms who came. Anyone left off can challenge, and Kleros jurors decide.",
  },
  {
    title: "Get paid",
    body: "Everyone who came claims their deposit back, plus an equal share of the no-shows' deposits. No-shows get nothing back.",
  },
] as const;

function Example() {
  const noShows = EXAMPLE.booked - EXAMPLE.came;
  return (
    <GlassCard
      as="section"
      className="home-example kb-rise"
      aria-labelledby="home-example-title"
      data-testid="home-example"
    >
      <h2 id="home-example-title" className="home-eyebrow">
        Example: {EXAMPLE.booked} guests deposited {ethText(EXAMPLE.deposit)} ETH each, and {EXAMPLE.came} showed up
      </h2>
      <dl className="home-rows">
        <div>
          <dt>
            All deposits ({EXAMPLE.booked} × {ethText(EXAMPLE.deposit)})
          </dt>
          <dd className="kb-num">{ethText(EXAMPLE.pool)} ETH</dd>
        </div>
        <div>
          <dt>Each of the {EXAMPLE.came} who showed up got</dt>
          <dd className="kb-num is-ok">{ethText(EXAMPLE.share)} ETH</dd>
        </div>
        <div>
          <dt>
            Each of the {noShows} {noShows === 1 ? "no-show got" : "no-shows got"}
          </dt>
          <dd className="kb-num is-err">0 ETH</dd>
        </div>
      </dl>
      <p className="home-note">
        That was their own {ethText(EXAMPLE.deposit)} ETH back, plus {ethText(EXAMPLE.share - EXAMPLE.deposit)} ETH from
        the no-shows&apos; deposits.
      </p>
    </GlassCard>
  );
}

/** The landing; `events` is the list the route composes from the event and organise features. */
export function HomeScreen({ events }: { events: ReactNode }) {
  return (
    <div className="home" data-testid="home">
      <section className="home-hero">
        <div className="home-hero-text">
          <h1 className="home-title">
            Turn sign-ups into guests.
            <span>Reward the people who show up.</span>
          </h1>
          <p className="home-lede">
            Web3 events get thousands of sign-ups, but only a fraction of guests actually show up. Proof of Presence
            asks every guest for a small refundable deposit, which turns each sign-up into a real commitment. Everyone
            who attends gets their deposit back plus a share of the no-shows&apos; deposits, and Kleros jurors settle
            any dispute over the attendance list.
          </p>
          <div className="home-actions">
            <Link href={paths.organiseNew.getHref()} className="kb-btn" data-testid="home-create">
              Create an event
            </Link>
            <Link href={paths.organise.getHref()} className="kb-btn is-quiet">
              Manage your events
            </Link>
          </div>
        </div>
        <Example />
      </section>

      <section className="home-section" id="events" aria-labelledby="home-events-title">
        <h2 id="home-events-title" className="home-h2">
          Events
        </h2>
        {events}
      </section>

      <section className="home-section" aria-labelledby="home-how-title">
        <h2 id="home-how-title" className="home-h2">
          How it works
        </h2>
        <ol className="home-steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <GlassCard className="home-step">
                <span className="home-step-n kb-num" aria-hidden>
                  {i + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </GlassCard>
            </li>
          ))}
        </ol>
      </section>

      <GlassCard as="section" className="home-court" aria-labelledby="home-court-title">
        <h2 id="home-court-title" className="home-h2">
          A fair list, settled by Kleros
        </h2>
        <p>
          Every event&apos;s contract has a built-in challenge process. A guest left off the list can say they were
          there, and independent jurors decide under a public attendance policy.
        </p>
        <p className="home-note">
          {isSepolia ? "Cases here go to the Test court (Sepolia). " : ""}The contracts have no owner and cannot be
          changed: nobody, not even the organiser, can take the deposits.
        </p>
      </GlassCard>
    </div>
  );
}
