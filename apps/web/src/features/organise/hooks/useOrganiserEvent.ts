"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { errorText, revertName } from "@kickback/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddressEqual, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { EventRefused } from "@/lib/presence";
import { STALE_TIME } from "@/lib/query";
import { useChainTime } from "@/lib/web3/chain-time";
import { useSend, useSendBusy } from "@/lib/web3/send";
import { useRestoringWallet } from "@/lib/web3/useRestoringWallet";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import { phaseOf } from "../model/phase";
import { readOrganiser } from "../operations/read";

type Request = { to: Address; data: `0x${string}`; value: bigint };

/** A well-formed contract address (anything else cannot be an event). */
export const isEventAddress = (address: string) => /^0x[0-9a-fA-F]{40}$/.test(address);

export const organiserKey = (address: string) => ["organise", DEFAULT_CHAIN_ID, address.toLowerCase()] as const;

/** One event, read for the shell and every tab under it, plus the one way its tabs send. */
export function useOrganiserEventSource(address: Address) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const queries = useQueryClient();
  const overview = useQuery({
    queryKey: organiserKey(address),
    // a link that is no address at all is refused without a read
    enabled: client !== undefined && isEventAddress(address),
    staleTime: STALE_TIME.live,
    // a refusal is final: no retry delay, no polling
    refetchInterval: (q) => (q.state.error instanceof EventRefused ? false : 15_000),
    retry: (count, e) => !(e instanceof EventRefused) && count < 1,
    queryFn: () => readOrganiser(client!, address),
  });
  const { address: account, chainId } = useAccount();
  const restoring = useRestoringWallet();
  const onChain = !!account && chainId === DEFAULT_CHAIN_ID;
  const data = overview.data;
  // the chain's clock, re-read every block: the overview read is up to 15 s old, so a tab could still offer
  // something the contract refuses since the start (or end) passed; take the later of the two
  const chainTime = useChainTime(DEFAULT_CHAIN_ID);
  const now = data ? Math.max(data.now, chainTime.data?.now ?? 0) : undefined;
  const isOwner = !!account && !!data && isAddressEqual(account, data.event.owner);
  // a late challenge still inside its answer time holds up the release: the pill says so
  const phase = data
    ? phaseOf(data.event, now!, data.challenges.filter((c) => c.state === 1 && now! <= c.matchEndsAt).length)
    : null;

  const [running, setRunning] = useState<string | null>(null);
  // a send's result belongs to the tab it was sent from (origin) and to the wallet that sent it (account): it is
  // shown only there, so it never reads as the result of another tab's control, and a wallet that switches away
  // and back still gets told how its send ended
  const [error, setError] = useState<{ text: string; at: number; origin: string; account?: Address } | null>(null);
  const [done, setDone] = useState<{ text: string; origin: string; account?: Address } | null>(null);
  const pathname = usePathname() ?? "";
  // leaving a tab drops its finished send's message, so it does not come back later; a send still confirming
  // keeps its tag and shows its result if the organiser goes back to that tab
  useEffect(() => {
    if (running === null) {
      setError(null);
      setDone(null);
    }
    // only a change of tab clears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  // the guests already there when the organiser opened this tab, per wallet: kept in memory across a wallet switch
  // and back (the tab's content unmounts while another wallet is connected), new on another tab or a reload
  const seen = useRef<{ path: string; byAccount: Map<string, Set<string>> }>({ path: "", byAccount: new Map() });
  const seenAtOpen = (wallets: readonly string[]): Set<string> | null => {
    if (!isOwner || !account) return null;
    const s = seen.current;
    if (s.path !== pathname) {
      s.path = pathname;
      s.byAccount.clear();
    }
    const key = account.toLowerCase();
    let set = s.byAccount.get(key);
    if (!set) s.byAccount.set(key, (set = new Set(wallets.map((w) => w.toLowerCase()))));
    return set;
  };
  const mine = (sender?: Address) => !!sender && !!account && isAddressEqual(sender, account);
  const busy = useSendBusy();
  const send = useSend({
    // awaited, so a tab never offers the same names again before the new list is read
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: organiserKey(address) }),
        queries.invalidateQueries({ queryKey: ["event", DEFAULT_CHAIN_ID, address.toLowerCase()] }),
      ]);
    },
  });

  /** Sends one request under a label ("Turn away 2"); `success` is said when it is confirmed. */
  const run = (
    label: string,
    request: () => Request | Promise<Request>,
    success: string,
    onSent?: () => void,
    /** Plain words for a contract refusal this action can meet, by its custom error ("TooLate"). */
    refusals?: Record<string, string>,
  ) => {
    setRunning(label);
    setError(null);
    setDone(null);
    const sender = account;
    const origin = pathname;
    send.mutate(
      { expectedAccount: sender, prepare: async () => await request() },
      {
        onSuccess: () => {
          setDone({ text: success, origin, account: sender });
          onSent?.();
        },
        onError: (e) => {
          const name = revertName(e) ?? revertName((e as { cause?: unknown }).cause);
          const known = name ? refusals?.[name] : undefined;
          setError({ text: known ?? (e.message || errorText(e)), at: Date.now(), origin, account: sender });
          // a refusal means the page is behind the chain: read it again so the controls follow
          if (name) void queries.invalidateQueries({ queryKey: organiserKey(address) });
        },
        onSettled: () => setRunning(null),
      },
    );
  };

  return {
    address,
    overview,
    phase,
    /** The chain's time (seconds): the later of the overview read and the latest block. */
    now,
    isOwner,
    connected: !!account,
    /** wagmi is restoring a saved session on page load: no "Connect" prompt yet. */
    restoring,
    /** Connected, and on the network the event lives on. */
    onChain,
    account,
    run,
    running,
    busy: busy || running !== null,
    /** The last send's failure, on the tab that sent it and for the wallet that sent it. */
    error: error && error.origin === pathname && mine(error.account) ? { text: error.text, at: error.at } : null,
    /** The last send's confirmation, on the tab that sent it and for the wallet that sent it. */
    done: done && done.origin === pathname && mine(done.account) ? done.text : null,
    /** The guests' wallets as they were when this wallet opened the tab (null unless it is the organiser's). */
    seenAtOpen,
    clearMessages: () => (setError(null), setDone(null)),
  };
}

export type OrganiserEvent = ReturnType<typeof useOrganiserEventSource>;

export const OrganiserEventContext = createContext<OrganiserEvent | null>(null);

export function useOrganiserEvent(): OrganiserEvent {
  const value = useContext(OrganiserEventContext);
  if (!value) throw new Error("useOrganiserEvent is used outside the organiser shell.");
  return value;
}
