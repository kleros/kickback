import { hardhat } from "viem/chains";

/**
 * The node the tests drive must be a Hardhat chain: a node already listening on the port (reused by the
 * webServer) may be another project's, or a mainnet fork.
 */
export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  }).catch(() => null);
  const chainId = response?.ok ? Number(((await response.json()) as { result?: string }).result) : undefined;

  if (chainId !== hardhat.id) {
    throw new Error(
      `The node at ${url} answers as chainId ${chainId ?? "nothing"}, not Hardhat's ${hardhat.id}. ` +
        "Stop it, or point the tests at a free port with E2E_RPC_PORT.",
    );
  }
}
