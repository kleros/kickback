import { TASK_NODE } from "hardhat/builtin-tasks/task-names";
import { task } from "hardhat/config";

export const DEFAULT_LOCAL_NODE_URL = "http://127.0.0.1:8545";

/** The node the localhost and mainnet-fork networks talk to, and `local-node` listens on. */
export const localNodeUrl = (env: NodeJS.ProcessEnv = process.env) => env.LOCAL_NODE_URL || DEFAULT_LOCAL_NODE_URL;

/** Host and port `hardhat node` binds for a node URL; an http URL without a port means port 80. */
export function nodeAddress(url: string): { hostname: string; port: number } {
  const u = new URL(url);
  if (u.protocol !== "http:") throw new Error(`LOCAL_NODE_URL must be an http:// URL, got ${url}`);
  return { hostname: u.hostname.replace(/^\[|\]$/g, ""), port: Number(u.port || 80) };
}

task("local-node", "Starts a Hardhat node on LOCAL_NODE_URL (default http://127.0.0.1:8545)").setAction(
  async (_args, hre) => {
    await hre.run(TASK_NODE, nodeAddress(localNodeUrl()));
  },
);
