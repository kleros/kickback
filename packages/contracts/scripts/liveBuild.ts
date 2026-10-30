import { readFileSync } from "node:fs";
import path from "node:path";

// solc-js pinned to the compiler the live contract was verified with
// eslint-disable-next-line @typescript-eslint/no-require-imports
const solc = require("solc");

const ROOT = path.join(__dirname, "..");
export const LIVE_DIR = path.join(ROOT, "deployments-live", "truth-pays-mainnet");

type SolcOutput = {
  errors?: { severity: string; formattedMessage: string }[];
  contracts: Record<
    string,
    Record<
      string,
      {
        abi: unknown[];
        evm: {
          bytecode: { object: string };
          deployedBytecode: { object: string; immutableReferences: Record<string, { start: number; length: number }[]> };
        };
      }
    >
  >;
};

export type LiveBuild = {
  abi: unknown[];
  bytecode: `0x${string}`;
  deployedBytecode: `0x${string}`;
  /** [start, length] byte ranges of the immutables in the runtime code */
  immutables: [number, number][];
};

/**
 * Compiles contracts/TruthPaysKickback.sol under the source key and settings of the standard JSON input
 * Etherscan verified, so the creation code is the live deployment's byte for byte (the metadata hash
 * depends on the source key, which Hardhat's own compile names `contracts/TruthPaysKickback.sol`).
 */
export function liveBuild(): LiveBuild {
  const verified = JSON.parse(readFileSync(path.join(LIVE_DIR, "standard-input.json"), "utf8"));
  const source = readFileSync(path.join(ROOT, "contracts", "TruthPaysKickback.sol"), "utf8");
  const input = {
    ...verified,
    sources: { "TruthPaysKickback.sol": { content: source } },
    settings: {
      ...verified.settings,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode"] } },
    },
  };
  const out: SolcOutput = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));

  const c = out.contracts["TruthPaysKickback.sol"]!.TruthPaysKickback!;
  const immutables = Object.values(c.evm.deployedBytecode.immutableReferences)
    .flat()
    .map(({ start, length }) => [start, length] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  return {
    abi: c.abi,
    bytecode: `0x${c.evm.bytecode.object}`,
    deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
    immutables,
  };
}

/** The verified standard input's own source, to compare with contracts/TruthPaysKickback.sol. */
export function verifiedSource(): string {
  const verified = JSON.parse(readFileSync(path.join(LIVE_DIR, "standard-input.json"), "utf8"));
  return verified.sources["TruthPaysKickback.sol"].content;
}
