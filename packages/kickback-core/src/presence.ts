import { presenceEventAbi, presenceFactoryAbi } from "@kickback/contracts";
import {
  AbiDecodingDataSizeTooSmallError,
  AbiDecodingZeroDataError,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  getAddress,
  isAddressEqual,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";

import { KickbackError, shortMessage } from "./kickbackError";
import { isContractCode } from "./logs";
import { isAddressStrict } from "./text";

/** The Proof of Presence contracts on one network. */
export interface Protocol {
  chainId: number;
  factory: Address;
  implementation?: Address;
  /** The factory's deploy block: events are never older. */
  fromBlock?: number;
  disputeResolver?: Address;
}

export type ReadClient = Pick<PublicClient, "getCode" | "readContract">;

/** Everything a page shows about an event, read on-chain in one round. */
export interface EventInfo {
  contract: Address;
  factory: Address;
  owner: Address;
  pendingOwner: Address;
  name: string;
  url: string;
  /** address(0) for ETH. */
  token: Address;
  symbol: string;
  decimals: number;
  depositAmount: bigint;
  /** Unix seconds. */
  eventStart: number;
  eventEnd: number;
  claimDeadline: number;
  /** 0 = no limit. */
  capacity: number;
  /** 0 Open, 1 Listed, 2 Finalized, 3 Cancelled. */
  phase: number;
  stakerCount: number;
  attendeeCount: number;
  /** Unix seconds; 0 until the list is closed. */
  challengeEndsAt: number;
  waitingChallenges: number;
  openCases: number;
  payoutShare: bigint;
  reservedPool: bigint;
  challengeEscrow: bigint;
  /** ETH each side of a challenge pays: Kleros's fee for the case. */
  challengeDeposit: bigint;
  challengePeriod: number;
  matchPeriod: number;
  disputeResolver: Address;
  arbitrator: Address;
  policyURI: string;
}

export const isEth = (token: Address) => isAddressEqual(token, zeroAddress);

const FIELDS = [
  "factory",
  "owner",
  "pendingOwner",
  "eventName",
  "eventURL",
  "token",
  "tokenSymbol",
  "tokenDecimals",
  "depositAmount",
  "eventStart",
  "eventEnd",
  "claimDeadline",
  "capacity",
  "summary",
  "challengeDeposit",
  "challengePeriod",
  "matchPeriod",
  "disputeResolver",
  "arbitrator",
  "arbitrationSettings",
] as const;

/**
 * The event at `address`, read on-chain and checked against `protocol`: the factory that made it
 * must be this app's and must list it (isEvent), so a look-alike contract is refused. Throws a
 * KickbackError: NOT_KICKBACK (not an address or not an event), NO_KICKBACK_CONTRACT (no code),
 * UNKNOWN_CODE (an event of another factory).
 */
export async function readEvent(
  client: ReadClient,
  address: string | undefined,
  protocol: Pick<Protocol, "factory"> | null,
): Promise<EventInfo> {
  if (!isAddressStrict(address))
    throw new KickbackError(
      `"${address ?? ""}" is not a contract address (0x… with 40 characters after it).`,
      "NOT_KICKBACK",
    );
  const contract = getAddress(String(address).toLowerCase());
  if (!isContractCode(await client.getCode({ address: contract })))
    throw new KickbackError(`There is no contract at ${contract} on this network.`, "NO_KICKBACK_CONTRACT");
  let r;
  try {
    // one round of reads (viem batches them into one request when the transport allows it)
    r = await Promise.all(
      FIELDS.map((functionName) => client.readContract({ address: contract, abi: presenceEventAbi, functionName })),
    );
  } catch (e) {
    // only an answer from the contract itself is a verdict on it; network trouble is passed on as it is
    const verdict =
      e instanceof BaseError &&
      !!e.walk(
        (x) =>
          x instanceof ContractFunctionZeroDataError ||
          x instanceof ContractFunctionRevertedError ||
          x instanceof AbiDecodingZeroDataError ||
          x instanceof AbiDecodingDataSizeTooSmallError,
      );
    if (!verdict) throw e;
    throw new KickbackError(
      `The contract at ${contract} is not a Proof of Presence event (${shortMessage(e)}).`,
      "NOT_KICKBACK",
      {
        cause: e,
      },
    );
  }
  const [
    factory,
    owner,
    pendingOwner,
    name,
    url,
    token,
    symbol,
    decimals,
    depositAmount,
    eventStart,
    eventEnd,
    claimDeadline,
    capacity,
    summary,
    challengeDeposit,
    challengePeriod,
    matchPeriod,
    disputeResolver,
    arbitrator,
    settings,
  ] = r as unknown as [
    Address,
    Address,
    Address,
    string,
    string,
    Address,
    string,
    number,
    bigint,
    bigint,
    bigint,
    bigint,
    number,
    readonly [number, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
    bigint,
    bigint,
    bigint,
    Address,
    Address,
    readonly [string, string],
  ];
  if (protocol) {
    const listed =
      isAddressEqual(factory, protocol.factory) &&
      (await client.readContract({
        address: protocol.factory,
        abi: presenceFactoryAbi,
        functionName: "isEvent",
        args: [contract],
      }));
    if (!listed)
      throw new KickbackError(
        `The contract at ${contract} looks like an event, but it was not created by this site's factory (${protocol.factory}).`,
        "UNKNOWN_CODE",
      );
  }
  const [
    phase,
    stakerCount,
    attendeeCount,
    challengeEndsAt,
    waitingChallenges,
    openCases,
    payoutShare,
    reservedPool,
    challengeEscrow,
  ] = summary;
  return {
    contract,
    factory,
    owner,
    pendingOwner,
    name,
    url,
    token,
    symbol,
    decimals: Number(decimals),
    depositAmount,
    eventStart: Number(eventStart),
    eventEnd: Number(eventEnd),
    claimDeadline: Number(claimDeadline),
    capacity: Number(capacity),
    phase: Number(phase),
    stakerCount: Number(stakerCount),
    attendeeCount: Number(attendeeCount),
    challengeEndsAt: Number(challengeEndsAt),
    waitingChallenges: Number(waitingChallenges),
    openCases: Number(openCases),
    payoutShare,
    reservedPool,
    challengeEscrow,
    challengeDeposit,
    challengePeriod: Number(challengePeriod),
    matchPeriod: Number(matchPeriod),
    disputeResolver,
    arbitrator,
    policyURI: settings[1],
  };
}

/** One wallet's place in an event. */
export interface GuestInfo {
  /** 0 None, 1 Staker, 2 Rejected, 3 Refunded. */
  status: number;
  attended: boolean;
  /** The event's asset this wallet can withdraw now. */
  claimable: bigint;
  /** Challenge money (ETH) this wallet can withdraw now. */
  claimableEth: bigint;
  sharePaid: bigint;
  challenge: ChallengeInfo;
}

export interface ChallengeInfo {
  /** 0 None, 1 Waiting, 2 Disputed, 3 Resolved. */
  state: number;
  /** Unix seconds. */
  matchEndsAt: number;
  matcher: Address;
  organiser: Address;
  deposit: bigint;
  arbitratorDisputeID: bigint;
  localDisputeID: bigint;
  /** ETH spent on the Kleros fee. */
  arbitrationPaid: bigint;
}

export async function readGuest(
  client: Pick<PublicClient, "readContract">,
  contract: Address,
  wallet: Address,
): Promise<GuestInfo> {
  const c = { address: contract, abi: presenceEventAbi, args: [wallet] } as const;
  const [status, attended, claimable, sharePaid, challenge] = await Promise.all([
    client.readContract({ ...c, functionName: "status" }),
    client.readContract({ ...c, functionName: "attended" }),
    client.readContract({ ...c, functionName: "claimable" }),
    client.readContract({ ...c, functionName: "sharePaid" }),
    client.readContract({ ...c, functionName: "challenges" }),
  ]);
  return {
    status: Number(status),
    attended,
    claimable: claimable[0],
    claimableEth: claimable[1],
    sharePaid,
    challenge: challengeOf(challenge),
  };
}

type RawChallenge = readonly [number, bigint | number, Address, Address, bigint, bigint, bigint, bigint];
export function challengeOf(raw: RawChallenge): ChallengeInfo {
  const [state, matchEndsAt, matcher, organiser, deposit, arbitratorDisputeID, localDisputeID, arbitrationPaid] = raw;
  return {
    state: Number(state),
    matchEndsAt: Number(matchEndsAt),
    matcher,
    organiser,
    deposit,
    arbitratorDisputeID,
    localDisputeID,
    arbitrationPaid,
  };
}

/** The events an organiser created, newest first. */
export async function eventsOf(client: Pick<PublicClient, "readContract">, factory: Address, organiser: Address) {
  const list = await client.readContract({
    address: factory,
    abi: presenceFactoryAbi,
    functionName: "eventsOf",
    args: [organiser],
  });
  return [...list].reverse();
}

/** The `limit` newest events of the factory. */
export async function latestEvents(client: Pick<PublicClient, "readContract">, factory: Address, limit = 12) {
  const count = await client.readContract({ address: factory, abi: presenceFactoryAbi, functionName: "eventCount" });
  const n = BigInt(limit);
  const offset = count > n ? count - n : 0n;
  const list = await client.readContract({
    address: factory,
    abi: presenceFactoryAbi,
    functionName: "events",
    args: [offset, n],
  });
  return [...list].reverse();
}

/** "0.01 ETH", "25 USDC": the exact amount in the event's asset. */
export const amountText = (units: bigint, ev: Pick<EventInfo, "decimals" | "symbol">) =>
  `${trimUnits(units, ev.decimals)} ${ev.symbol}`;

function trimUnits(units: bigint, decimals: number) {
  const neg = units < 0n;
  const s = (neg ? -units : units).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals) || "0";
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
