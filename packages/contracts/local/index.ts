import {
  encodeAbiParameters,
  getAddress,
  parseEther,
  type Account,
  type Address,
  type Chain,
  type ContractConstructorArgs,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";

import { genericCaseTemplateText, genericPolicyText } from "../generated/docs";
import {
  kickbackAbi,
  kickbackBytecode,
  mockArbitrableProxyAbi,
  mockArbitrableProxyBytecode,
  mockKlerosLiquidAbi,
  mockKlerosLiquidBytecode,
} from "../generated/index";
import { caseTemplate, ipfsPathOf, templateValues, type CaseTemplate } from "./caseTemplate";

export * from "./caseTemplate";
export { genericCaseTemplateText, genericPolicyText, truthPaysCaseTemplateText } from "../generated/docs";

export const DAY = 86_400;
export const DEFAULT_DEPOSIT = parseEther("0.01");
/** KlerosLiquid extra data: abi.encode(court, minJurors); court 0 is the General Court. */
export const klerosExtraData = (court = 0n, jurors = 3n): Hex =>
  encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [court, jurors]);

export type KickbackArgs = ContractConstructorArgs<typeof kickbackAbi>;
export type LocalWalletClient = WalletClient<Transport, Chain | undefined, Account>;

type Clients = { walletClient: LocalWalletClient; publicClient: PublicClient };

async function deploy(
  { walletClient, publicClient }: Clients,
  // viem's deployContract generics cannot be satisfied by a union of ABIs, so each caller passes its own
  send: () => Promise<Hex>,
) {
  const hash = await send();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error(`deploy from ${walletClient.account.address} failed (tx ${hash})`);
  return { address: getAddress(receipt.contractAddress), receipt };
}

/** Deploys MockKlerosLiquid and a MockArbitrableProxy (the Dispute Resolver) in front of it. */
export async function deployMockKleros(clients: Clients) {
  const { walletClient } = clients;
  const chain = walletClient.chain ?? null;
  const arbitrator = await deploy(clients, () =>
    walletClient.deployContract({ abi: mockKlerosLiquidAbi, bytecode: mockKlerosLiquidBytecode, chain }),
  );
  const disputeResolver = await deploy(clients, () =>
    walletClient.deployContract({
      abi: mockArbitrableProxyAbi,
      bytecode: mockArbitrableProxyBytecode,
      args: [arbitrator.address],
      chain,
    }),
  );
  return { arbitrator: arbitrator.address, disputeResolver: disputeResolver.address };
}

/** Deploys TruthPaysKickback from the live build's creation code. */
export async function deployKickback(clients: Clients, args: KickbackArgs) {
  const { walletClient } = clients;
  const { address, receipt } = await deploy(clients, () =>
    walletClient.deployContract({
      abi: kickbackAbi,
      bytecode: kickbackBytecode,
      args,
      chain: walletClient.chain ?? null,
    }),
  );
  return { event: address, deployBlock: receipt.blockNumber, receipt };
}

export type EventDetails = {
  eventTitle: string;
  eventName: string;
  eventWhen: string;
  eventWhere: string;
  hosts: string;
  eventLink: string;
};

export type DeployLocalEventOptions = Clients & {
  /** The contract's owner, named in each case; defaults to the wallet client's account. */
  owner?: Address;
  depositAmount?: bigint;
  /** Unix seconds; defaults to the latest block's time + 3 days. */
  eventStart?: bigint;
  /** Unix seconds; defaults to eventStart + 14 days. */
  claimDeadline?: bigint;
  details?: Partial<EventDetails>;
  /** Template text with {{placeholders}}; defaults to the generic template. */
  templateText?: string;
  /** Defaults to the IPFS path of the generic policy's bytes. */
  policyURI?: string;
  /** An existing Dispute Resolver; when unset, mocks are deployed. `arbitrator` is then read from the contract. */
  disputeResolver?: Address;
  extraData?: Hex;
  explorer?: string;
};

/**
 * Deploys MockKlerosLiquid + MockArbitrableProxy (unless `disputeResolver` is given) and one
 * TruthPaysKickback with the generic juror policy and case template. Framework-free: any viem clients.
 */
export async function deployLocalEvent(options: DeployLocalEventOptions) {
  const { walletClient, publicClient } = options;
  const owner = getAddress(options.owner ?? walletClient.account.address);
  const depositAmount = options.depositAmount ?? DEFAULT_DEPOSIT;
  const now = (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
  const eventStart = options.eventStart ?? now + BigInt(3 * DAY);
  const claimDeadline = options.claimDeadline ?? eventStart + BigInt(14 * DAY);

  const mocks = options.disputeResolver ? undefined : await deployMockKleros(options);
  const disputeResolver = getAddress(options.disputeResolver ?? mocks!.disputeResolver);

  const details: EventDetails = {
    eventTitle: "Kickback local test event",
    eventName: "Kickback Local",
    eventWhen: `${new Date(Number(eventStart) * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC`,
    eventWhere: "Local test venue",
    hosts: "Kickback local stack",
    eventLink: "https://luma.com/kickback-local",
    ...options.details,
  };
  const policyURI = options.policyURI ?? ipfsPathOf(genericPolicyText);
  const values = templateValues(
    {
      ...details,
      depositUnits: depositAmount,
      explorer: options.explorer ?? "https://etherscan.io",
      kleros: { policyURI },
    },
    owner,
  );
  const tpl = caseTemplate(options.templateText ?? genericCaseTemplateText, values);
  const template: CaseTemplate = { pieces: tpl.pieces, slots: tpl.slots };
  const extraData = options.extraData ?? klerosExtraData();

  const args: KickbackArgs = [
    depositAmount,
    details.eventName,
    owner,
    eventStart,
    claimDeadline,
    { disputeResolver, extraData, metaEvidenceTemplate: template.pieces, metaEvidenceSlots: template.slots, policyURI },
  ];
  const { event, deployBlock } = await deployKickback(options, args);
  const arbitrator = await publicClient.readContract({ address: event, abi: kickbackAbi, functionName: "arbitrator" });

  return {
    event,
    disputeResolver,
    arbitrator: getAddress(arbitrator),
    deployBlock,
    owner,
    args,
    template,
    policyURI,
    details,
  };
}

export type LocalEvent = Awaited<ReturnType<typeof deployLocalEvent>>;
