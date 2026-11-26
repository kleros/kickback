"use client";

import { useEffect, useState } from "react";

import { presenceEventAbi } from "@kickback/contracts";
import { gasLimitFor, isEth, revertName } from "@kickback/core";
import { useAppKit, useAppKitState } from "@reown/appkit/react";
import { useQuery } from "@tanstack/react-query";
import { getConnectorClient } from "@wagmi/core";
import { encodeFunctionData, type Address } from "viem";
import { addChain } from "viem/actions";
import { useAccount, useBalance, usePublicClient, useSwitchChain } from "wagmi";

import { STALE_TIME } from "@/lib/query";
import { useChainTime } from "@/lib/web3/chain-time";
import { isUnknownChain } from "@/lib/web3/chainErrors";
import { connectWallet, hasInjectedWallet, installedWallets } from "@/lib/web3/connect";
import { SendError, useSentTx, useSendBusy } from "@/lib/web3/send";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";
import { caseUrl, FROM_BLOCK, resolverCaseUrl } from "@/config/protocol";

import { useDeposit } from "./useDeposit";
import { useGuestMoney } from "./useGuestMoney";
import { useBlockTime, useCreatedBlock, useEventDeposits, type KickbackEvent } from "../api/useEvent";
import { chainName } from "../model/chainNames";
import { depositState, depositsOpen, type DepositInput, type DepositView } from "../model/depositState";
import { dayText, deadlineText } from "../model/when";
import { readRelease } from "../operations/guestMoney";

/** The network fee the wallet reserves for a deposit: gas limit × max fee per gas. */
function useDepositFee(contract: Address, account: Address | undefined, value: bigint, enabled: boolean) {
  // a token deposit cannot be estimated before the approval; its fee is close to an ETH deposit's plus a transfer

  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  return useQuery({
    queryKey: ["deposit-fee", DEFAULT_CHAIN_ID, contract.toLowerCase(), account?.toLowerCase(), value.toString()],
    enabled: enabled && client !== undefined && account !== undefined,
    staleTime: STALE_TIME.balance,
    refetchInterval: 15_000,
    retry: false,
    queryFn: async () => {
      const gas =
        value === 0n
          ? 120_000n
          : await client!.estimateGas({
              account: account!,
              to: contract,
              data: encodeFunctionData({ abi: presenceEventAbi, functionName: "deposit" }),
              value,
            });
      const fees = await client!.estimateFeesPerGas();
      return gasLimitFor(gas) * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n);
    },
  });
}

/** The network fee a challenge is expected to cost: a fixed gas allowance, since a wallet that cannot pay
 * would make estimateGas throw. */
function useChallengeFee(enabled: boolean) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  return useQuery({
    queryKey: ["challenge-fee", DEFAULT_CHAIN_ID],
    enabled: enabled && client !== undefined,
    staleTime: STALE_TIME.balance,
    refetchInterval: 15_000,
    retry: false,
    queryFn: async () => {
      const fees = await client!.estimateFeesPerGas();
      return gasLimitFor(150_000n) * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n);
    },
  });
}

/** Re-renders every second while `on`, for the pending timer. */
function useTicker(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

export interface DepositController {
  view: DepositView;
  connect: () => void;
  switchChain: () => void;
  addChain: () => void;
  deposit: () => void;
  withdraw: () => void;
  claim: () => void;
  challenge: () => void;
  approve: () => void;
  resolve: () => void;
  release: () => void;
  /** The latest block's time, unix seconds; undefined while loading. */
  now?: number;
  depositOpen: boolean;
  /** Chain time has passed the event's end. False while chain time is loading. */
  ended: boolean;
  recheck: () => void;
  wallet?: Address;
}

/** The deposit card's state machine: wallet, chain, balance, history and the pending record, folded into one view. */
export function useDepositState(event: KickbackEvent, from?: string): DepositController {
  const { address, chainId, status } = useAccount();
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  const { open } = useAppKit();
  const { open: modalOpen } = useAppKitState();
  const { switchChainAsync } = useSwitchChain();
  const [asked, setAsked] = useState(false);
  const [needsChain, setNeedsChain] = useState(false);
  const [chainFailed, setChainFailed] = useState(false);
  const [hasProvider, setHasProvider] = useState(true);
  useEffect(() => setHasProvider(hasInjectedWallet()), []);
  // a connected guest starts over: a later disconnect should not show "no wallet" straight away
  useEffect(() => {
    if (status === "connected") setAsked(false);
  }, [status]);
  // a new account, chain or connection: an old "not in your wallet" answer no longer holds
  useEffect(() => {
    setNeedsChain(false);
    setChainFailed(false);
  }, [address, chainId, status]);

  const connected = status === "connected" && address !== undefined;
  // wagmi restoring the last session on page load, not a connect the guest started
  const restoring = !connected && (status === "reconnecting" || (status === "connecting" && !asked));
  const onChain = connected && chainId === DEFAULT_CHAIN_ID;

  const { data: chainTime } = useChainTime();
  const token = isEth(event.token) ? undefined : event.token;
  const created = useCreatedBlock(event.contract, from === undefined ? undefined : Number(from));
  // a failed created-block scan still lets the deposit logs load, from the factory's deploy
  const deposits = useEventDeposits(event.contract, created.data ?? (created.isError ? FROM_BLOCK : undefined));
  const mine = address ? deposits.data?.byWallet.get(address.toLowerCase()) : undefined;
  const depositedAt = useBlockTime(mine?.block);
  const money = useGuestMoney(event.contract, token, event.depositAmount, event.challengeDeposit);
  const busy = useSendBusy();
  const phase = event.phase;
  const refundedAt = useBlockTime(mine?.refundedBlock);
  const balance = useBalance({
    address,
    chainId: DEFAULT_CHAIN_ID,
    query: { enabled: onChain, refetchInterval: 10_000 },
  });
  const fee = useDepositFee(event.contract, address, token ? 0n : event.depositAmount, onChain);
  const sentTx = useSentTx(event.contract);
  const now = chainTime?.now;
  const windowOver = phase === 1 && !!event.challengeEndsAt && now !== undefined && now > event.challengeEndsAt;
  const challengeOpen = phase === 1 && !!event.challengeEndsAt && now !== undefined && !windowOver;
  const challengeFee = useChallengeFee(onChain && challengeOpen);
  // anyone can release payouts after the window: the card offers it to attendees when nothing blocks it
  const release = useQuery({
    queryKey: ["release", DEFAULT_CHAIN_ID, event.contract.toLowerCase()],
    enabled: client !== undefined && windowOver,
    staleTime: STALE_TIME.live,
    refetchInterval: 15_000,
    queryFn: () => readRelease(client!, event.contract),
  });
  const send = useDeposit(event.contract, event.token, event.depositAmount);

  const sendError = send.error instanceof SendError ? send.error : undefined;
  const sent = sentTx.data ? { ...sentTx.data.record, outcome: sentTx.data.outcome } : null;
  const waiting = send.isPending || sent?.outcome === "pending";
  const wallNow = useTicker(waiting);

  // a failed log read gives an empty history, so the card falls back to the wallet link instead of spinning
  const history: DepositInput["history"] = connected
    ? deposits.data
      ? mine
        ? {
            paidTx: mine.paid?.tx,
            txHash: mine.txHash,
            at: depositedAt.data,
            refundedAt: mine.refundedBlock === undefined ? undefined : refundedAt.data,
          }
        : {}
      : deposits.isError
        ? {}
        : undefined
    : undefined;

  const view = depositState({
    amount: event.depositAmount,
    asset: { symbol: event.symbol, decimals: event.decimals, token },
    eventStart: event.eventStart,
    eventEnd: event.eventEnd,
    phase,
    claimDeadline: event.claimDeadline,
    challengeEndsAt: event.challengeEndsAt,
    challengeDeposit: event.challengeDeposit,
    capacity: event.capacity,
    stakerCount: event.stakerCount,
    guest: money.query.data,
    guestUnknown: connected && money.query.data === undefined,
    allowance: money.query.data?.allowance,
    tokenBalance: money.query.data?.tokenBalance,
    moneySend: money.send,
    busy,
    chainNow: chainTime?.now,
    chain: { id: DEFAULT_CHAIN_ID, name: DEFAULT_CHAIN.name },
    wallet: {
      status: connected ? "connected" : asked && (status === "connecting" || modalOpen) ? "connecting" : "disconnected",
      address,
      chainId,
      hasProvider,
      asked,
      needsChain,
      chainFailed,
      restoring,
    },
    balance: balance.data?.value,
    fee: fee.data,
    challengeFee: challengeFee.data,
    release: release.data,
    history,
    sent,
    send: {
      status: send.status,
      account: send.account,
      startedAt: send.startedAt,
      hash: send.data?.transactionHash ?? sendError?.hash,
      errorKind: sendError?.kind,
      errorMessage: send.error?.message,
      errorName: sendError?.kind === "refused" ? revertName(sendError.cause) : undefined,
    },
    wallNow,
    guests: event.stakerCount,
    explorer: DEFAULT_CHAIN.blockExplorers?.default.url,
    dayText: (unix) => dayText(unix, event.clock),
    timeText: (unix) => deadlineText(unix, event.clock),
    caseUrl: (id) => caseUrl(DEFAULT_CHAIN_ID, id),
    evidenceUrl: (id) => resolverCaseUrl(DEFAULT_CHAIN_ID, id),
    chainName,
  });

  return {
    view,
    wallet: address,
    depositOpen: depositsOpen(phase, event.eventEnd, chainTime?.now),
    ended: chainTime?.now !== undefined && chainTime.now >= event.eventEnd,
    withdraw: money.withdraw,
    claim: money.claim,
    challenge: money.challenge,
    approve: money.approve,
    resolve: money.resolve,
    release: money.release,
    now,
    connect: () => {
      // a session being restored is already connecting: a second connect() would race it
      if (restoring) return;
      setHasProvider(installedWallets().length > 0 || hasInjectedWallet());
      setAsked(true);
      void connectWallet(() => open({ view: "Connect" }));
    },
    switchChain: () => {
      switchChainAsync({ chainId: DEFAULT_CHAIN_ID }).then(
        () => setNeedsChain(false),
        (error: unknown) => setNeedsChain(isUnknownChain(error)),
      );
    },
    addChain: () => {
      setChainFailed(false);
      void getConnectorClient(wagmiConfig)
        .then((client) => addChain(client, { chain: DEFAULT_CHAIN }))
        .then(() => switchChainAsync({ chainId: DEFAULT_CHAIN_ID }))
        .then(() => setNeedsChain(false))
        .catch(() => setChainFailed(true));
    },
    deposit: () => {
      send.reset();
      send.deposit();
    },
    recheck: () => {
      void balance.refetch();
      void money.query.refetch();
      void fee.refetch();
    },
  };
}
