import { assertHardhatNode, assertKickbackApp } from "./utils/servers";

const rpc = async (url: string, method: string) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
  }).catch(() => null);
  return response?.ok ? ((await response.json()) as { result?: string }).result : undefined;
};

/** The node must be a Hardhat chain and the app this one, whichever process is answering on their ports. */
export default async function globalSetup() {
  const nodeUrl = process.env.NEXT_PUBLIC_LOCAL_RPC_URL!;
  const chainId = await rpc(nodeUrl, "eth_chainId");
  assertHardhatNode(nodeUrl, chainId === undefined ? undefined : Number(chainId));

  const appUrl = process.env.E2E_BASE_URL!;
  const page = await fetch(appUrl).catch(() => null);
  assertKickbackApp(appUrl, page?.ok ? await page.text() : undefined);
}
