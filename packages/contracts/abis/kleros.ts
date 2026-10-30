// Kleros Court v1 on Ethereum mainnet: the fragments the app calls, copied from contracts/test/MockKleros.sol,
// whose signatures and public getter layouts follow the live contracts.

/** KlerosLiquid (0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069): the court; its IDs are arbitrator dispute IDs. */
export const klerosLiquidAbi = [
  {
    inputs: [{ name: "extraData", type: "bytes" }],
    name: "arbitrationCost",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "id", type: "uint256" },
      { name: "", type: "bytes" },
    ],
    name: "appealCost",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "id", type: "uint256" }],
    name: "appealPeriod",
    outputs: [
      { name: "start", type: "uint256" },
      { name: "end", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "id", type: "uint256" }],
    name: "currentRuling",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "uint256" }],
    name: "disputes",
    outputs: [
      { name: "subcourtID", type: "uint96" },
      { name: "arbitrated", type: "address" },
      { name: "numberOfChoices", type: "uint256" },
      { name: "period", type: "uint8" },
      { name: "lastPeriodChange", type: "uint256" },
      { name: "drawsInRound", type: "uint256" },
      { name: "commitsInRound", type: "uint256" },
      { name: "ruled", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "id", type: "uint256" }],
    name: "passPeriod",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "id", type: "uint256" }],
    name: "executeRuling",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Kleros's Dispute Resolver, an ArbitrableProxy (0x4b89e798b10478a839ea0abcf86c4b94a3c782a4); its IDs are local dispute IDs.
 * disputeIDtoRoundArray(localID, round) returns feeRewards only (getters drop mappings and arrays) and reverts past the last round.
 * Contribution and RulingFunded carry the mock's indexed layout. The live contract's layout is unconfirmed: decode their logs
 * by topic count, as the legacy pages do (see disputeResolverEventLayouts).
 */
export const disputeResolverAbi = [
  {
    inputs: [],
    name: "arbitrator",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "uint256" }],
    name: "disputes",
    outputs: [
      { name: "arbitratorExtraData", type: "bytes" },
      { name: "isRuled", type: "bool" },
      { name: "ruling", type: "uint256" },
      { name: "disputeIDOnArbitratorSide", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "", type: "uint256" }],
    name: "externalIDtoLocalID",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getMultipliers",
    outputs: [
      { name: "_winnerStakeMultiplier", type: "uint256" },
      { name: "_loserStakeMultiplier", type: "uint256" },
      { name: "_loserAppealPeriodMultiplier", type: "uint256" },
      { name: "_denominator", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "_localDisputeID", type: "uint256" },
      { name: "_evidenceURI", type: "string" },
    ],
    name: "submitEvidence",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "_localDisputeID", type: "uint256" },
      { name: "_ruling", type: "uint256" },
    ],
    name: "fundAppeal",
    outputs: [{ name: "fullyFunded", type: "bool" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "_localDisputeID", type: "uint256" },
      { name: "_contributor", type: "address" },
      { name: "_contributedTo", type: "uint256[]" },
    ],
    name: "withdrawFeesAndRewardsForAllRounds",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "_localDisputeID", type: "uint256" },
      { name: "_contributor", type: "address" },
      { name: "_contributedTo", type: "uint256[]" },
    ],
    name: "getTotalWithdrawableAmount",
    outputs: [{ name: "sum", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "uint256" },
    ],
    name: "disputeIDtoRoundArray",
    outputs: [{ name: "feeRewards", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "localDisputeID", type: "uint256" },
      { indexed: true, name: "round", type: "uint256" },
      { indexed: false, name: "ruling", type: "uint256" },
      { indexed: true, name: "contributor", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
    name: "Contribution",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "localDisputeID", type: "uint256" },
      { indexed: true, name: "round", type: "uint256" },
      { indexed: true, name: "ruling", type: "uint256" },
    ],
    name: "RulingFunded",
    type: "event",
  },
] as const;

type EventInput = { name: string; type: string };
const CONTRIBUTION_INPUTS: EventInput[] = [
  { name: "localDisputeID", type: "uint256" },
  { name: "round", type: "uint256" },
  { name: "ruling", type: "uint256" },
  { name: "contributor", type: "address" },
  { name: "amount", type: "uint256" },
];
const RULING_FUNDED_INPUTS: EventInput[] = [
  { name: "localDisputeID", type: "uint256" },
  { name: "round", type: "uint256" },
  { name: "ruling", type: "uint256" },
];

const layout = (name: string, inputs: EventInput[], indexed: number[]) => ({
  type: "event" as const,
  name,
  anonymous: false,
  inputs: inputs.map((input, i) => ({ ...input, indexed: indexed.includes(i) })),
});

/**
 * Every indexed layout of the two Dispute Resolver appeal events the legacy decoders accept, keyed by the
 * number of topics a log has (indexed fields + 1). The topic hash is the same for all of them.
 */
export const disputeResolverEventLayouts = {
  Contribution: {
    1: layout("Contribution", CONTRIBUTION_INPUTS, []),
    2: layout("Contribution", CONTRIBUTION_INPUTS, [0]),
    3: layout("Contribution", CONTRIBUTION_INPUTS, [0, 1]),
    4: layout("Contribution", CONTRIBUTION_INPUTS, [0, 1, 3]),
  },
  RulingFunded: {
    1: layout("RulingFunded", RULING_FUNDED_INPUTS, []),
    2: layout("RulingFunded", RULING_FUNDED_INPUTS, [0]),
    3: layout("RulingFunded", RULING_FUNDED_INPUTS, [0, 1]),
    4: layout("RulingFunded", RULING_FUNDED_INPUTS, [0, 1, 2]),
  },
} as const;
