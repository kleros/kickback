import { hardhat } from "viem/chains";

import { siteConfig } from "@/config/site";

/** Ports the suite starts its own servers on; off 3000 and 8545, where a dev server or node usually runs. */
export const E2E_APP_PORT = "3117";
export const E2E_RPC_PORT = "8645";

/** Throws unless the node at `url` answered eth_chainId as Hardhat's chain. */
export function assertHardhatNode(url: string, chainId: number | undefined) {
  if (chainId !== hardhat.id) {
    throw new Error(
      `The node at ${url} answers as chainId ${chainId ?? "nothing"}, not Hardhat's ${hardhat.id}. ` +
        "Stop it, or point the tests at a free port with E2E_RPC_PORT.",
    );
  }
}

/** Throws unless the page served at `url` is this app's, judged by its <title>. */
export function assertKickbackApp(url: string, html: string | undefined) {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html ?? "")?.[1]?.trim();
  if (title !== siteConfig.name) {
    throw new Error(
      `The app at ${url} has the title ${JSON.stringify(title ?? null)}, not "${siteConfig.name}". ` +
        "Stop that server, or point the tests at a free port with E2E_BASE_URL.",
    );
  }
}
