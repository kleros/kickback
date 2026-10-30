"use client";

import type { NetworkInput } from "@kickback/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";

import { useSend } from "@/lib/web3/send";

import {
  createConfig,
  jurorPreview,
  pinGenericPolicy,
  readDeployments,
  saveDeployment,
  type BrowserDeployment,
} from "../model/create";
import { pinEventInfo, eventInfoTransport, prepareEventDeployment } from "../operations/eventInfo";
import { policyTransport } from "../operations/policy";

export interface DeployInput {
  form: unknown;
  owner: Address;
  policyURI: string;
  confirmation?: string;
}
export const DEPLOYMENT_SEND_BLOCKER =
  "Deployment is unavailable: useSend requires a recipient address. Contract creation must omit the recipient; the shared send layer needs deployment support.";

export function useDeploy(network: NetworkInput) {
  const client = usePublicClient({ chainId: Number(network.chainId) });
  const queries = useQueryClient();
  const send = useSend();
  return useMutation({
    mutationFn: (input: DeployInput) =>
      send.mutateAsync({
        prepare: async () => {
          if (!client) throw new Error("The network connection is unavailable.");
          if (readDeployments().length && input.confirmation !== "NEW")
            throw new Error("Type NEW to create another event from this browser.");
          const block = await client.getBlock();
          await prepareEventDeployment(input.form, network, input.owner, input.policyURI, Number(block.timestamp));
          throw new Error(DEPLOYMENT_SEND_BLOCKER);
        },
      }),
    onSuccess: async (receipt, input) => {
      if (!receipt.contractAddress) throw new Error("The receipt did not contain a deployed contract.");
      const deployment: BrowserDeployment = {
        address: receipt.contractAddress,
        chainId: Number(network.chainId),
        block: Number(receipt.blockNumber),
        name: createConfig(input.form, network, input.owner).eventName!,
      };
      saveDeployment(deployment);
      await queries.invalidateQueries({ queryKey: ["organise"] });
    },
  });
}

export function useCreateEvent(
  network: NetworkInput,
  transport: Parameters<typeof pinGenericPolicy>[0] = policyTransport(),
  infoTransport = eventInfoTransport(),
) {
  const deployments = useQuery({
    queryKey: ["organise", "deployments"],
    queryFn: () => readDeployments(),
    staleTime: Infinity,
  });
  const pin = useMutation({ mutationFn: () => pinGenericPolicy(transport) });
  const info = useMutation({ mutationFn: (input: unknown) => pinEventInfo(input, infoTransport) });
  const deploy = useDeploy(network);
  return {
    deployments,
    pin,
    info,
    deploy,
    preview: (input: unknown, policyURI: string, owner?: Address, infoPath?: string | null) =>
      jurorPreview(input, network, policyURI, owner, infoPath),
  };
}
