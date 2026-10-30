"use client";

import { kickbackAbi, kickbackBytecode } from "@kickback/contracts";
import type { NetworkInput } from "@kickback/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { encodeDeployData, type Address } from "viem";
import { usePublicClient } from "wagmi";

import { useSend } from "@/lib/web3/send";

import { DEFAULT_CHAIN_ID } from "@/config/chains";

import {
  createDeployment,
  jurorPreview,
  pinGenericPolicy,
  readDeployments,
  saveDeployment,
  type BrowserDeployment,
} from "../model/create";
import { policyTransport } from "../operations/policy";

export interface DeployInput {
  form: unknown;
  owner: Address;
  policyURI: string;
  confirmation?: string;
}
export function useDeploy(network: NetworkInput) {
  const client = usePublicClient({ chainId: Number(network.chainId) });
  const queries = useQueryClient();
  const send = useSend({ record: true });
  return useMutation({
    mutationFn: (input: DeployInput) =>
      send.mutateAsync({
        prepare: async () => {
          if (!client) throw new Error("The network connection is unavailable.");
          if (Number(network.chainId) !== DEFAULT_CHAIN_ID) throw new Error("This app cannot deploy on that network.");
          if (readDeployments().length && input.confirmation !== "NEW")
            throw new Error("Type NEW to create another event from this browser.");
          const block = await client.getBlock();
          const { args } = createDeployment(input.form, network, input.owner, input.policyURI, Number(block.timestamp));
          const [deposit, name, owner, start, deadline, [disputeResolver, extraData, pieces, slots, policyURI]] = args;
          const data = encodeDeployData({
            abi: kickbackAbi,
            bytecode: kickbackBytecode,
            args: [
              deposit,
              name,
              owner,
              BigInt(start),
              BigInt(deadline),
              { disputeResolver, extraData, metaEvidenceTemplate: pieces, metaEvidenceSlots: slots, policyURI },
            ],
          });
          return { data, value: 0n };
        },
      }),
    onSuccess: async (receipt, input) => {
      if (!receipt.contractAddress) throw new Error("The receipt did not contain a deployed contract.");
      const deployment: BrowserDeployment = {
        address: receipt.contractAddress,
        chainId: Number(network.chainId),
        block: Number(receipt.blockNumber),
        name: createDeployment(input.form, network, input.owner, input.policyURI, 0).config.eventName!,
      };
      saveDeployment(deployment);
      await queries.invalidateQueries({ queryKey: ["organise"] });
    },
  });
}

export function useCreateEvent(
  network: NetworkInput,
  transport: Parameters<typeof pinGenericPolicy>[0] = policyTransport(),
) {
  const deployments = useQuery({
    queryKey: ["organise", "deployments"],
    queryFn: () => readDeployments(),
    staleTime: Infinity,
  });
  const pin = useMutation({ mutationFn: () => pinGenericPolicy(transport) });
  const deploy = useDeploy(network);
  return {
    deployments,
    pin,
    deploy,
    preview: (input: unknown, policyURI: string, owner?: Address) => jurorPreview(input, network, policyURI, owner),
  };
}
