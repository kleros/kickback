import {
  decodeEventLog,
  getAddress,
  parseEther,
  zeroAddress,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
} from "viem";

import { caseTemplateText, policyText } from "../generated/docs";
import {
  mockArbitrableProxyAbi,
  mockArbitrableProxyBytecode,
  mockKlerosLiquidAbi,
  mockKlerosLiquidBytecode,
  presenceCaseWriterAbi,
  presenceCaseWriterBytecode,
  presenceEventAbi,
  presenceEventBytecode,
  presenceFactoryAbi,
  presenceFactoryBytecode,
} from "../generated/index";
import {
  caseTemplate,
  DEFAULT_PERIODS,
  ipfsPathOf,
  klerosExtraData,
  MIN_SETTLEMENT_WINDOW,
  type EventConfig,
} from "./protocol";

export * from "./protocol";
export { caseTemplateText, policyText } from "../generated/docs";

export const DAY = 86_400;
export const DEFAULT_DEPOSIT = parseEther("0.01");
/** MockKlerosLiquid's fee per juror on a local chain: 3 jurors make a 0.015 ETH challenge deposit. */
export const LOCAL_FEE_PER_JUROR = parseEther("0.005");

export type LocalWalletClient = WalletClient<Transport, Chain | undefined, Account>;
type Clients = { walletClient: LocalWalletClient; publicClient: PublicClient };

async function mined({ walletClient, publicClient }: Clients, hash: Hex, what: string) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${what} from ${walletClient.account.address} failed (tx ${hash})`);
  return receipt;
}

async function deploy(clients: Clients, what: string, send: () => Promise<Hex>) {
  const receipt = await mined(clients, await send(), `deploy ${what}`);
  if (!receipt.contractAddress) throw new Error(`deploy ${what}: no contract address`);
  return { address: getAddress(receipt.contractAddress), receipt };
}

/** Deploys MockKlerosLiquid (fee per juror set) and a MockArbitrableProxy (the Dispute Resolver) in front of it. */
export async function deployMockKleros(clients: Clients, { feePerJuror = LOCAL_FEE_PER_JUROR } = {}) {
  const { walletClient } = clients;
  const chain = walletClient.chain ?? null;
  const arbitrator = await deploy(clients, "MockKlerosLiquid", () =>
    walletClient.deployContract({ abi: mockKlerosLiquidAbi, bytecode: mockKlerosLiquidBytecode, chain }),
  );
  await mined(
    clients,
    await walletClient.writeContract({
      address: arbitrator.address,
      abi: mockKlerosLiquidAbi,
      functionName: "setFeeForJuror",
      args: [feePerJuror],
      chain,
    }),
    "setFeeForJuror",
  );
  const disputeResolver = await deploy(clients, "MockArbitrableProxy", () =>
    walletClient.deployContract({
      abi: mockArbitrableProxyAbi,
      bytecode: mockArbitrableProxyBytecode,
      args: [arbitrator.address],
      chain,
    }),
  );
  return { arbitrator: arbitrator.address, disputeResolver: disputeResolver.address };
}

export type ProtocolSettings = {
  disputeResolver: Address;
  extraData?: Hex;
  /** Defaults to the IPFS path of docs/attendance-policy.md's bytes. */
  policyURI?: string;
  /** Defaults to docs/metaevidence.template.json. */
  templateText?: string;
  network?: string;
  explorer?: string;
  challengePeriod?: bigint;
  matchPeriod?: bigint;
};

/** Deploys the case writer (template), the event implementation (Kleros settings), then the factory. */
export async function deployProtocol(clients: Clients, s: ProtocolSettings) {
  const { walletClient } = clients;
  const chain = walletClient.chain ?? null;
  const policyURI = s.policyURI ?? ipfsPathOf(policyText);
  const template = caseTemplate(s.templateText ?? caseTemplateText, {
    policyURI,
    network: s.network ?? "Local test chain",
    explorer: s.explorer ?? "https://etherscan.io",
  });
  const writer = await deploy(clients, "PresenceCaseWriter", () =>
    walletClient.deployContract({
      abi: presenceCaseWriterAbi,
      bytecode: presenceCaseWriterBytecode,
      args: [template.pieces, template.slots],
      chain,
    }),
  );
  const impl = await deploy(clients, "PresenceEvent", () =>
    walletClient.deployContract({
      abi: presenceEventAbi,
      bytecode: presenceEventBytecode,
      args: [
        getAddress(s.disputeResolver),
        s.extraData ?? klerosExtraData(),
        policyURI,
        writer.address,
        s.challengePeriod ?? DEFAULT_PERIODS.challenge,
        s.matchPeriod ?? DEFAULT_PERIODS.match,
      ],
      chain,
    }),
  );
  const factory = await deploy(clients, "PresenceFactory", () =>
    walletClient.deployContract({
      abi: presenceFactoryAbi,
      bytecode: presenceFactoryBytecode,
      args: [impl.address],
      chain,
    }),
  );
  return {
    caseWriter: writer.address,
    implementation: impl.address,
    factory: factory.address,
    deployBlock: writer.receipt.blockNumber,
    policyURI,
    template,
  };
}

/** The contract address in a createEvent receipt. */
export function createdEvent(receipt: TransactionReceipt, factory: Address): Address {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: presenceFactoryAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "EventCreated") return getAddress(ev.args.eventContract);
    } catch {
      // another event of the factory
    }
  }
  throw new Error("no EventCreated in the receipt");
}

/** A Config for a local test event: starts in `startIn` seconds and lasts `hours`. */
export function localEventConfig(
  now: bigint,
  { startIn = BigInt(3 * DAY), hours = 4n, ...rest }: Partial<EventConfig> & { startIn?: bigint; hours?: bigint } = {},
): EventConfig {
  const eventStart = rest.eventStart ?? now + startIn;
  const eventEnd = rest.eventEnd ?? eventStart + hours * 3600n;
  return {
    name: "Proof of Presence local test",
    url: "https://luma.com/proof-of-presence-local",
    token: zeroAddress,
    depositAmount: DEFAULT_DEPOSIT,
    capacity: 0,
    ...rest,
    eventStart,
    eventEnd,
    claimDeadline: rest.claimDeadline ?? eventEnd + BigInt(MIN_SETTLEMENT_WINDOW) * 2n,
  };
}

/** Creates one event from `factory`, organised by the wallet client's account. */
export async function createEvent(clients: Clients, factory: Address, config: EventConfig) {
  const { walletClient } = clients;
  const receipt = await mined(
    clients,
    await walletClient.writeContract({
      address: factory,
      abi: presenceFactoryAbi,
      functionName: "createEvent",
      args: [config],
      chain: walletClient.chain ?? null,
    }),
    "createEvent",
  );
  return { event: createdEvent(receipt, factory), deployBlock: receipt.blockNumber, receipt };
}

export type DeployLocalEventOptions = Clients &
  Partial<EventConfig> & {
    /** An existing protocol; when unset, the Kleros mocks and the protocol are deployed. */
    factory?: Address;
    startIn?: bigint;
    hours?: bigint;
  };

/**
 * Deploys the Kleros mocks and the protocol (unless `factory` is given), then creates one event.
 * Framework-free: any viem clients.
 */
export async function deployLocalEvent(options: DeployLocalEventOptions) {
  const { walletClient, publicClient, factory: given, ...cfg } = options;
  const clients = { walletClient, publicClient };
  let kleros: Awaited<ReturnType<typeof deployMockKleros>> | undefined;
  let protocol: Awaited<ReturnType<typeof deployProtocol>> | undefined;
  if (!given) {
    kleros = await deployMockKleros(clients);
    protocol = await deployProtocol(clients, { disputeResolver: kleros.disputeResolver });
  }
  const factory = given ?? protocol!.factory;
  const now = (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
  const config = localEventConfig(now, cfg);
  const created = await createEvent(clients, factory, config);
  return { ...created, factory, config, organiser: getAddress(walletClient.account.address), kleros, protocol };
}

export type LocalEvent = Awaited<ReturnType<typeof deployLocalEvent>>;
