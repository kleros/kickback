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
    title: "Book a spot",
    body: "Guests send the deposit (ETH or a token like USDC) from their own wallet, and they are in. Bookings stay open until the event ends, for walk-ins. Anyone the organiser turns away gets it all back.",
  },
  {
    title: "Show up",
    body: "After the event, the organiser posts who came. Anyone left off can challenge the list, and Kleros jurors decide.",
  },
  {
    title: "Get paid",
    body: "The pool is split equally among everyone on the list. No-shows lose their deposit.",
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
        {EXAMPLE.booked} guests book at {ethText(EXAMPLE.deposit)} ETH, {EXAMPLE.came} come
      </h2>
      <dl className="home-rows">
        <div>
          <dt>Pool</dt>
          <dd className="kb-num">{ethText(EXAMPLE.pool)} ETH</dd>
        </div>
        <div>
          <dt>Each guest who came</dt>
          <dd className="kb-num is-ok">{ethText(EXAMPLE.share)} ETH</dd>
        </div>
        <div>
          <dt>Each no-show</dt>
          <dd className="kb-num is-err">0 ETH</dd>
        </div>
      </dl>
      <p className="home-note">
        Their {ethText(EXAMPLE.deposit)} ETH back, plus an equal share of the {noShows} no-shows&apos; deposits.
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
            Turn signups into guests.
            <span>Reward the people who show up.</span>
          </h1>
          <p className="home-lede">
            Web3 events get thousands of signups and only a fraction of the guests actually show up. Proof of Presence
            asks every guest for a small refundable deposit, which turns each booking into a real commitment. Everyone
            who attends gets their deposit back plus a share of the no-shows&apos; deposits, and a fair attendance list
            backed by Kleros settles any dispute.
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
          Every event&apos;s contract has a challenge built in. A guest left off the list can say they were there, and
          independent jurors decide under a public attendance policy.
        </p>
        <p className="home-note">
          {isSepolia ? "Cases here go to the Test court (Sepolia). " : ""}The contracts have no owner and cannot be
          changed: nobody, not even the organiser, can take the deposits.
        </p>
      </GlassCard>
    </div>
  );
}
