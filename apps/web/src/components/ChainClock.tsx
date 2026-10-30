"use client";

import { useChainTime } from "@/lib/web3/chain-time";

/** The chain's time, as of the latest block: the clock every deadline in the app is read against. */
export function ChainClock() {
  const { data } = useChainTime();

  return (
    <p className="type-caption text-klerosUIComponentsSecondaryText">
      Chain time:{" "}
      <time data-testid="chain-time" data-unix={data?.now} dateTime={data && new Date(data.now * 1000).toISOString()}>
        {data ? new Date(data.now * 1000).toUTCString() : "…"}
      </time>
    </p>
  );
}
