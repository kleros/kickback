"use client";

import { useEffect, useState } from "react";

import { kickbackAbi } from "@kickback/contracts";
import { gasLimitFor } from "@kickback/core";
import { useAppKit, useAppKitState } from "@reown/appkit/react";
import { useQuery } from "@tanstack/react-query";
import { getConnectorClient } from "@wagmi/core";
import { encodeFunctionData, type Address } from "viem";
import { addChain } from "viem/actions";
import { useAccount, useBalance, usePublicClient, useSwitchChain } from "wagmi";

import { STALE_TIME } from "@/lib/query";
import { useChainTime } from "@/lib/web3/chain-time";
import { SendError, useSentTx } from "@/lib/web3/send";
import { wagmiConfig } from "@/lib/web3/wagmi";

import { DEFAULT_CHAIN, DEFAULT_CHAIN_ID } from "@/config/chains";

import { useDeposit } from "./useDeposit";
import { useBlockTime, useEventDeposits, type KickbackEvent } from "../api/useEvent";
import { chainName } from "../model/chainNames";
import { depositState, type DepositInput, type DepositView } from "../model/depositState";
import { dayText } from "../model/when";

const hasInjectedWallet = () => typeof window !== "undefined" && "ethereum" in window && !!window.ethereum;

/** wallet_switchEthereumChain's "unknown chain" code, wherever viem nested it. */
const isUnknownChain = (error: unknown): boolean => {
  for (let e = error as { code?: number; cause?: unknown } | undefined; e; e = e.cause as typeof e)
    if (e.code === 4902) return true;
  return false;
};

/** The network fee the wallet reserves for a deposit: gas limit × max fee per gas. */
function useDepositFee(contract: Address, account: Address | undefined, value: bigint, enabled: boolean) {
  const client = usePublicClient({ chainId: DEFAULT_CHAIN_ID });
  return useQuery({
    queryKey: ["deposit-fee", DEFAULT_CHAIN_ID, contract.toLowerCase(), account?.toLowerCase(), value.toString()],
    enabled: enabled && client !== undefined && account !== undefined,
    staleTime: STALE_TIME.balance,
    refetchInterval: 15_000,
    retry: false,
    queryFn: async () => {
      const gas = await client!.estimateGas({
        account: account!,
        to: contract,
        data: encodeFunctionData({ abi: kickbackAbi, functionName: "deposit" }),
        value,
      });
      const fees = await client!.estimateFeesPerGas();
      return gasLimitFor(gas) * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n);
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
  recheck: () => void;
  wallet?: Address;
}

/** The deposit card's state machine: wallet, chain, balance, history and the pending record, folded into one view. */
export function useDepositState(event: KickbackEvent, fromBlock: number | undefined): DepositController {
  const { address, chainId, status } = useAccount();
  const { open } = useAppKit();
  const { open: modalOpen } = useAppKitState();
  const { switchChainAsync } = useSwitchChain();
  const [asked, setAsked] = useState(false);
  const [needsChain, setNeedsChain] = useState(false);
  const [hasProvider, setHasProvider] = useState(true);
  useEffect(() => setHasProvider(hasInjectedWallet()), []);

  const connected = status === "connected" && address !== undefined;
  const onChain = connected && chainId === DEFAULT_CHAIN_ID;

  const { data: chainTime } = useChainTime();
  const deposits = useEventDeposits(event.contract, fromBlock);
  const mine = address ? deposits.data?.byWallet.get(address.toLowerCase()) : undefined;
  const depositedAt = useBlockTime(mine?.block);
  const refundedAt = useBlockTime(mine?.refundedBlock);
  const balance = useBalance({
    address,
    chainId: DEFAULT_CHAIN_ID,
    query: { enabled: onChain, refetchInterval: 10_000 },
  });
  const fee = useDepositFee(event.contract, address, event.depositAmount, onChain);
  const sentTx = useSentTx(event.contract);
  const send = useDeposit(event.contract, event.depositAmount);

  const sendError = send.error instanceof SendError ? send.error : undefined;
  const sent = sentTx.data ? { ...sentTx.data.record, outcome: sentTx.data.outcome } : null;
  const waiting = send.isPending || sent?.outcome === "pending";
  const wallNow = useTicker(waiting);

  const history: DepositInput["history"] =
    connected && deposits.data
      ? mine
        ? {
            deposited: mine.deposited,
            txHash: mine.txHash,
            at: depositedAt.data,
            refundedAt: mine.refundedBlock === undefined ? undefined : (refundedAt.data ?? chainTime?.now),
          }
        : { deposited: 0n }
      : undefined;

  const view = depositState({
    amount: event.depositAmount,
    eventStart: event.eventStart,
    phase: event.phase,
    chainNow: chainTime?.now,
    chain: { id: DEFAULT_CHAIN_ID, name: DEFAULT_CHAIN.name },
    wallet: {
      status: connected ? "connected" : status === "connecting" || (asked && modalOpen) ? "connecting" : "disconnected",
      address,
      chainId,
      hasProvider,
      asked,
      needsChain,
    },
    balance: balance.data?.value,
    fee: fee.data,
    history,
    sent,
    send: {
      status: send.status,
      account: send.account,
      startedAt: send.startedAt,
      hash: send.data?.transactionHash ?? sendError?.hash,
      errorKind: sendError?.kind,
      errorMessage: send.error?.message,
    },
    wallNow,
    guests: deposits.data?.guests,
    explorer: DEFAULT_CHAIN.blockExplorers?.default.url,
    dayText: (unix) => dayText(unix, event.clock),
    chainName,
  });

  return {
    view,
    wallet: address,
    connect: () => {
      setAsked(true);
      void open({ view: "Connect" });
    },
    switchChain: () => {
      switchChainAsync({ chainId: DEFAULT_CHAIN_ID }).then(
        () => setNeedsChain(false),
        (error: unknown) => setNeedsChain(isUnknownChain(error)),
      );
    },
    addChain: () => {
      void getConnectorClient(wagmiConfig)
        .then((client) => addChain(client, { chain: DEFAULT_CHAIN }))
        .then(() => switchChainAsync({ chainId: DEFAULT_CHAIN_ID }))
        .then(() => setNeedsChain(false))
        .catch(() => {});
    },
    deposit: () => {
      send.reset();
      send.deposit();
    },
    recheck: () => {
      void balance.refetch();
      void fee.refetch();
    },
  };
}
