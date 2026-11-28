"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { presenceEventAbi } from "@kickback/contracts";
import { errorText, revertName } from "@kickback/core";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddressEqual, type Address, type Hash } from "viem";
import { useAccount, usePublicClient } from "wagmi";

import { EventRefused } from "@/lib/presence";
import { STALE_TIME } from "@/lib/query";
import { useChainTime } from "@/lib/web3/chain-time";
import {
  DEPLOY_RECORD_KEY,
  isSendBusy,
  SendError,
  sentTxStore,
  useSend,
  useSendBusy,
  useSendHolder,
  useSentTx,
} from "@/lib/web3/send";
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
  // the organiser, re-read on every block (the same block watcher as the clock): a handover locks the page for the
  // old organiser, and opens it for the new one, within a block instead of at the next 15 s read
  const block = chainTime.data?.blockNumber;
  const liveOwner = useQuery({
    queryKey: [...organiserKey(address), "owner", block?.toString() ?? "latest"],
    enabled: client !== undefined && isEventAddress(address) && !!data && block !== undefined,
    staleTime: STALE_TIME.immutable,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () =>
      client!.readContract({
        address,
        abi: presenceEventAbi,
        functionName: "owner",
        blockNumber: block,
      }) as Promise<Address>,
  }).data;
  const ownerChanged = !!data && !!liveOwner && !isAddressEqual(liveOwner, data.event.owner);
  useEffect(() => {
    // the snapshot is behind the chain: read it again, so no tab mixes the old event with the new organiser
    if (ownerChanged) void queries.invalidateQueries({ queryKey: organiserKey(address), exact: true });
  }, [ownerChanged, liveOwner, address, queries]);
  const isOwner = !!account && !!data && isAddressEqual(account, liveOwner ?? data.event.owner);
  // a late challenge still inside its answer time holds up the release: the pill says so
  const phase = data
    ? phaseOf(
        data.event,
        now!,
        data.challenges.filter((c) => c.state === 1 && now! <= c.matchEndsAt).length,
        // Staker (1) or Refunded (3): a deposit was held at the end; none means nothing was ever due
        data.guests.some((g) => g.status === 1 || g.status === 3),
      )
    : null;

  // the send under way: its label ("Turn away 2"), the sentence that says so, the wallets it touches, and the tab
  // and wallet that sent it (a tab remounted after a wallet switch away and back can still say it is confirming)
  const [running, setRunning] = useState<{
    label: string;
    text: string;
    wallets: readonly string[];
    origin: string;
    account?: Address;
  } | null>(null);
  // set synchronously on the first press: a second press in the same tick never starts a second send
  const runningRef = useRef(false);
  // a send's result belongs to the tab it was sent from (origin) and to the wallet that sent it (account): it is
  // shown only there, so it never reads as the result of another tab's control, and a wallet that switches away
  // and back still gets told how its send ended
  const [error, setError] = useState<{ text: string; at: number; origin: string; account?: Address } | null>(null);
  const [done, setDone] = useState<{ text: string; tx?: Hash; origin: string; account?: Address } | null>(null);
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
  // per wallet: another wallet's send in this browser does not lock this one's controls
  const busy = useSendBusy(account);
  const holder = useSendHolder(account);
  const send = useSend({
    // recorded, so a reload while it confirms still knows about it and does not offer the same send again
    record: true,
    // awaited, so a tab never offers the same names again before the new list is read
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: organiserKey(address) }),
        queries.invalidateQueries({ queryKey: ["event", DEFAULT_CHAIN_ID, address.toLowerCase()] }),
      ]);
    },
  });

  // a send from this wallet still confirming from before a reload (or from another tab): everything waits for it
  const sent = useSentTx(isOwner ? address : undefined);
  const ownHash = send.data?.transactionHash;
  const sendError = send.error instanceof SendError ? send.error : undefined;
  // this visit's own send whose receipt wait ran out is still confirming too: the buttons stay locked
  const timedOut = sendError?.kind === "unconfirmed" && !!sent.data && sendError.hash === sent.data.record.hash;
  const earlierPending =
    isOwner &&
    !!sent.data &&
    sent.data.outcome === "pending" &&
    !send.isPending &&
    (sent.data.record.hash !== ownHash || timedOut);
  const sentOutcome = sent.data?.outcome;
  const sentHash = sent.data?.record.hash;
  useEffect(() => {
    if (!sentOutcome || sentOutcome === "pending" || !sentHash || !account) return;
    // settled: read its effect now, not at the next poll, and forget it so it never shows again
    void queries.invalidateQueries({ queryKey: organiserKey(address) });
    void queries.invalidateQueries({ queryKey: ["event", DEFAULT_CHAIN_ID, address.toLowerCase()] });
    sentTxStore.forget(DEFAULT_CHAIN_ID, address, account, sentHash as Hash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentOutcome, sentHash]);

  /** Sends one request under a label ("Turn away 2"); `success` is said when it is confirmed. */
  const run = (
    label: string,
    request: () => Request | Promise<Request>,
    success: string,
    onSent?: () => void,
    /** Plain words for a contract refusal this action can meet, by its custom error ("TooLate"). */
    refusals?: Record<string, string>,
    /** The sentence shown while it confirms ("Turning away 1 guest… Waiting for confirmation."), and its wallets. */
    progress?: { pending: string; wallets?: readonly string[] },
  ) => {
    if (runningRef.current || earlierPending || isSendBusy(account)) return;
    runningRef.current = true;
    const sender = account;
    const origin = pathname;
    setRunning({
      label,
      text: progress?.pending ?? "Your transaction is waiting for confirmation.",
      wallets: progress?.wallets ?? [],
      origin,
      account: sender,
    });
    setError(null);
    setDone(null);
    send.mutate(
      { expectedAccount: sender, prepare: async () => await request() },
      {
        onSuccess: (receipt) => {
          setDone({ text: success, tx: receipt.transactionHash, origin, account: sender });
          onSent?.();
        },
        onError: (e) => {
          const name = revertName(e) ?? revertName((e as { cause?: unknown }).cause);
          const known = name ? refusals?.[name] : undefined;
          setError({ text: known ?? (e.message || errorText(e)), at: Date.now(), origin, account: sender });
          // a refusal means the page is behind the chain: read it again so the controls follow
          if (name) void queries.invalidateQueries({ queryKey: organiserKey(address) });
        },
        onSettled: () => {
          runningRef.current = false;
          setRunning(null);
        },
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
    /** The label of the send under way ("Turn away 2"), or null. */
    running: running?.label ?? null,
    /** This wallet's send still confirming, on the tab that sent it: what it says, and the wallets it touches. */
    pending:
      running && running.origin === pathname && mine(running.account)
        ? { text: running.text, wallets: running.wallets }
        : null,
    /** A send from this wallet, from before a reload or another tab (or one whose wait ran out), still confirming. */
    earlier: earlierPending && sent.data ? { hash: sent.data.record.hash, at: sent.data.record.at } : null,
    busy: busy || running !== null || earlierPending,
    /**
     * A send from this wallet that this page did not start (another event, the create page, or this event from a
     * page since left) still confirming: why the buttons are locked. `hash` is unknown while the wallet's prompt is
     * open; `where` says what it was for.
     */
    elsewhere:
      busy && running === null && !earlierPending && holder
        ? {
            hash: holder.hash ?? null,
            where: !holder.contract
              ? ("unknown" as const)
              : isAddressEqual(holder.contract, DEPLOY_RECORD_KEY)
                ? ("create" as const)
                : isAddressEqual(holder.contract, address)
                  ? ("this" as const)
                  : ("other" as const),
          }
        : null,
    /** The last send's failure, on the tab that sent it and for the wallet that sent it. */
    error: error && error.origin === pathname && mine(error.account) ? { text: error.text, at: error.at } : null,
    /** The last send's confirmation, on the tab that sent it and for the wallet that sent it. */
    done: done && done.origin === pathname && mine(done.account) ? done.text : null,
    /** The confirmed send's transaction, beside `done`. */
    doneTx: done && done.origin === pathname && mine(done.account) ? (done.tx ?? null) : null,
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
