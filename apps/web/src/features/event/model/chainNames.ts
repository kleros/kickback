/** Names for the networks a guest's wallet is most likely to be on instead. */
const NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "OP Mainnet",
  56: "BNB Chain",
  100: "Gnosis",
  137: "Polygon",
  324: "zkSync",
  8453: "Base",
  42161: "Arbitrum One",
  59144: "Linea",
  11155111: "Sepolia",
  31337: "Hardhat",
};

export const chainName = (id: number): string | undefined => NAMES[id];
